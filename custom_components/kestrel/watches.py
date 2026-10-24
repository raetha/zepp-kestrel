"""Paired watches and pending pairings."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, cast

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    PAIR_STARTS_PER_WINDOW,
    PAIR_WINDOW,
    PAIRING_MAX_ATTEMPTS,
    PAIRING_TTL,
    PROBES_KEPT,
    PROBES_SAVE_DELAY,
    PROBES_STORAGE_KEY,
    SEEN_EVERY,
    SIGNAL_WATCH_ADDED,
    STATUS_SAVE_DELAY,
    STORAGE_KEY,
    STORAGE_VERSION,
    signal_watch_updated,
)
from .issues import check_external_url
from .watchdata import PAINTS_MAX_SPOTS, SECTIONS, clean_paints, clean_rooms, clean_settings, settings_of


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Pairing:
    """A watch waiting for its code to be entered."""

    pairing_id: str
    watch_name: str
    code: str
    expires: float
    attempts: int = 0


@dataclass
class Watches:
    """Paired watches (persisted, one device each), pairings in progress (memory only)
    and recent probe results (persisted, for diagnostics downloads)."""

    hass: HomeAssistant
    entry_id: str
    version: str = ""
    store: Store[dict[str, Any]] = field(init=False)
    probe_store: Store[dict[str, Any]] = field(init=False)
    watches: dict[str, dict[str, Any]] = field(default_factory=dict)
    pairings: dict[str, Pairing] = field(default_factory=dict)
    starts: dict[str, deque[float]] = field(default_factory=dict)
    seen_seqs: dict[str, deque[Any]] = field(default_factory=dict)
    probes: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=PROBES_KEPT))

    def __post_init__(self) -> None:  # noqa: D105
        self.store = Store(self.hass, STORAGE_VERSION, STORAGE_KEY)
        self.probe_store = Store(self.hass, STORAGE_VERSION, PROBES_STORAGE_KEY)

    async def async_load(self) -> None:
        data = await self.store.async_load() or {}
        self.watches = data.get("watches", {})
        probes = await self.probe_store.async_load() or {}
        self.probes.extend(probes.get("probes", []))

    async def _async_save(self) -> None:
        await self.store.async_save({"watches": self.watches})

    # ------------------------------------------------------------ pairing
    def allow_start(self, client: str, now: float | None = None) -> bool:
        """Rate-limit pairing requests per client address."""
        now = time.monotonic() if now is None else now
        q = self.starts.setdefault(client, deque())
        while q and now - q[0] > PAIR_WINDOW:
            q.popleft()
        if len(q) >= PAIR_STARTS_PER_WINDOW:
            return False
        q.append(now)
        return True

    def start_pairing(self, watch_name: str, now: float | None = None) -> Pairing:
        now = time.monotonic() if now is None else now
        self._expire(now)
        pairing = Pairing(
            pairing_id=secrets.token_hex(8),
            watch_name=(watch_name or "Watch").strip()[:40] or "Watch",
            code=f"{secrets.randbelow(1_000_000):06d}",
            expires=now + PAIRING_TTL,
        )
        self.pairings[pairing.pairing_id] = pairing
        return pairing

    def _expire(self, now: float) -> None:
        for pid in [p for p, v in self.pairings.items() if v.expires < now]:
            del self.pairings[pid]

    async def async_confirm(
        self, pairing_id: str, code: str, now: float | None = None
    ) -> tuple[str, dict[str, Any] | None, str | None]:
        """Check a code. Returns (status, watch, token): ok | wrong | gone."""
        now = time.monotonic() if now is None else now
        self._expire(now)
        pairing = self.pairings.get(pairing_id)
        if pairing is None:
            return "gone", None, None
        if not hmac.compare_digest(pairing.code, str(code).strip()):
            pairing.attempts += 1
            if pairing.attempts >= PAIRING_MAX_ATTEMPTS:
                del self.pairings[pairing_id]
                return "gone", None, None
            return "wrong", None, None
        del self.pairings[pairing_id]
        token = secrets.token_urlsafe(32)
        watch_id = secrets.token_hex(6)
        watch = {"id": watch_id, "name": pairing.watch_name, "token_hash": _hash(token), "paired_at": time.time()}
        self.watches[watch_id] = watch
        await self._async_save()
        self._device(watch)
        check_external_url(self.hass, True)
        async_dispatcher_send(self.hass, SIGNAL_WATCH_ADDED, watch_id)
        return "ok", watch, token

    # ------------------------------------------------------------ paired watches
    def by_token(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        h = _hash(token)
        for w in self.watches.values():
            if hmac.compare_digest(w["token_hash"], h):
                return w
        return None

    async def async_remove(self, watch_ids: list[str]) -> None:
        for wid in watch_ids:
            self.watches.pop(wid, None)
            self.seen_seqs.pop(wid, None)
        kept = [p for p in self.probes if p.get("watch_id") not in watch_ids]
        if len(kept) != len(self.probes):
            self.probes.clear()
            self.probes.extend(kept)
            self._save_probes()
        await self._async_save()

    # ------------------------------------------------------------ synced data (watchdata.py)
    def synced(self, watch_id: str) -> dict[str, Any]:
        """Everything the watch keeps in sync, with each section's revision."""
        w = self.watches[watch_id]
        out: dict[str, Any] = {"settings": settings_of(w), "paints": w.get("paints", {}), "rooms": w.get("rooms", {})}
        for section in SECTIONS:
            out[f"{section}_rev"] = w.get(f"{section}_rev", 0)
        return out

    def paints(self, watch_id: str) -> dict[str, list[dict[str, Any]]]:
        return cast(dict[str, list[dict[str, Any]]], self.watches.get(watch_id, {}).get("paints", {}))

    async def _async_set(self, watch_id: str, section: str, value: Any) -> int:
        w = self.watches[watch_id]
        w[section] = value
        w[f"{section}_rev"] = w.get(f"{section}_rev", 0) + 1
        await self._async_save()
        async_dispatcher_send(self.hass, signal_watch_updated(watch_id))
        return int(w[f"{section}_rev"])

    async def async_save_paints(self, watch_id: str, paints: dict[str, Any]) -> int:
        """Replace a watch's paints with a cleaned copy; returns the new revision."""
        return await self._async_set(watch_id, "paints", clean_paints(paints))

    async def async_save_rooms(self, watch_id: str, rooms: dict[str, Any]) -> int:
        return await self._async_set(watch_id, "rooms", clean_rooms(rooms))

    async def async_update_settings(self, watch_id: str, values: dict[str, Any]) -> int:
        """Some settings changed ({group: {field: value}}, checked here): from the watch,
        the Zepp app's settings page or an entity. Returns the new revision."""
        settings = settings_of(self.watches[watch_id])
        for group, changed in clean_settings(values).items():
            settings[group].update(changed)
        return await self._async_set(watch_id, "settings", settings)

    async def async_save_settings(self, watch_id: str, settings: dict[str, Any]) -> int:
        """All settings, from the integration's options."""
        return await self._async_set(watch_id, "settings", settings)

    async def async_remove_paint(self, watch_id: str, entity_id: str, last_only: bool = False) -> int:
        """Forget a device's paints, or only its newest spot (a bad paint)."""
        paints = dict(self.paints(watch_id))
        spots = paints.get(entity_id, [])
        if last_only and len(spots) > 1:
            paints[entity_id] = spots[:-1]
        else:
            paints.pop(entity_id, None)
        return await self._async_set(watch_id, "paints", paints)

    async def async_reassign_paint(self, watch_id: str, entity_id: str, new_entity_id: str) -> int:
        """Point a device's paints at another entity (merged with any it already has)."""
        paints = dict(self.paints(watch_id))
        spots = paints.pop(entity_id, [])
        paints[new_entity_id] = (paints.get(new_entity_id, []) + spots)[-PAINTS_MAX_SPOTS:]
        return await self._async_set(watch_id, "paints", paints)

    async def async_remove_room(self, watch_id: str, area_id: str) -> int:
        rooms = dict(self.watches[watch_id].get("rooms", {}))
        rooms.pop(area_id, None)
        return await self._async_set(watch_id, "rooms", rooms)

    # ------------------------------------------------------------ status (sensors)
    def status(self, watch_id: str) -> dict[str, Any]:
        """What a watch last reported: last_seen, address, app_version, room, last_fired."""
        return cast(dict[str, Any], self.watches.get(watch_id, {}).get("status", {}))

    def note_status(self, watch_id: str, **fields: Any) -> None:
        """Record what a watch reported (None = not reported). Saved lazily; entities update.

        "last seen" alone moves on at most every SEEN_EVERY seconds, so a burst of
        requests doesn't flood the recorder.
        """
        watch = self.watches.get(watch_id)
        if watch is None:
            return
        status = watch.setdefault("status", {})
        changed = {k: v for k, v in fields.items() if v is not None and status.get(k) != v}
        now = dt_util.utcnow()
        last = dt_util.parse_datetime(status["last_seen"]) if status.get("last_seen") else None
        if not changed and last is not None and (now - last).total_seconds() < SEEN_EVERY:
            return
        status.update(changed)
        status["last_seen"] = now.isoformat()
        if "app_version" in changed:
            self._device(watch)
        self.store.async_delay_save(lambda: {"watches": self.watches}, STATUS_SAVE_DELAY)
        async_dispatcher_send(self.hass, signal_watch_updated(watch_id))

    # ------------------------------------------------------------ probe results
    def add_probe(self, watch: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        """Keep a probe result (the newest PROBES_KEPT) and return the event data for it."""
        # the watch's own fields win over anything in the body with the same name
        record = {**result, "watch_id": watch["id"], "watch_name": watch["name"], "received": dt_util.utcnow().isoformat()}
        self.probes.append(record)
        self._save_probes()
        return record

    def probes_for(self, watch_id: str | None = None) -> list[dict[str, Any]]:
        return [p for p in self.probes if watch_id is None or p.get("watch_id") == watch_id]

    def _save_probes(self) -> None:
        self.probe_store.async_delay_save(lambda: {"probes": list(self.probes)}, PROBES_SAVE_DELAY)

    # ------------------------------------------------------------ devices
    def _device(self, watch: dict[str, Any]) -> dr.DeviceEntry:
        return dr.async_get(self.hass).async_get_or_create(
            config_entry_id=self.entry_id,
            identifiers={(DOMAIN, watch["id"])},
            name=watch["name"],
            manufacturer="Amazfit",
            model="Zepp OS watch",
            sw_version=watch.get("status", {}).get("app_version"),
        )

    def sync_devices(self) -> None:
        """One device per paired watch; devices of watches no longer paired are removed."""
        dev_reg = dr.async_get(self.hass)
        for watch in self.watches.values():
            self._device(watch)
        for device in dr.async_entries_for_config_entry(dev_reg, self.entry_id):
            ids = {ident for domain, ident in device.identifiers if domain == DOMAIN}
            if not ids & set(self.watches):
                dev_reg.async_remove_device(device.id)

    async def async_clear(self) -> None:
        self.watches = {}
        self.probes.clear()
        await self.store.async_remove()
        await self.probe_store.async_remove()

    def first_time(self, watch_id: str, seq: Any) -> bool:
        """True the first time a command sequence number is seen (retries are dropped)."""
        if seq is None:
            return True
        q = self.seen_seqs.setdefault(watch_id, deque(maxlen=64))
        if seq in q:
            return False
        q.append(seq)
        return True
