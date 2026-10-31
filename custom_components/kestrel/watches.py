"""Paired watches and pending pairings."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
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
    DETAILED_DIAGNOSTICS_FOR,
    DOMAIN,
    PAIR_STARTS_PER_WINDOW,
    PAIR_WINDOW,
    PAIRING_MAX_ATTEMPTS,
    PAIRING_TTL,
    PAIRINGS_PENDING_MAX,
    PROBES_KEPT,
    PROBES_MAX_AGE,
    PROBES_SAVE_DELAY,
    PROBES_MAX_CHARS,
    PROBES_STORAGE_KEY,
    REMOVED_KEPT_DAYS,
    SEEN_EVERY,
    SIGNAL_WATCH_ADDED,
    STATUS_SAVE_DELAY,
    STORAGE_KEY,
    STORAGE_VERSION,
    TAKE_OVER_WINDOW,
    VOLUME_MIN_INTERVAL,
    WATCH_NAME_MAX,
    signal_watch_updated,
)
from .targets import Offered
from .watchdata import (
    PAINTS_MAX_DEVICES,
    PAINTS_MAX_SPOTS,
    ROOMS_MAX,
    SECTIONS,
    clean_paints,
    clean_rooms,
    clean_settings,
    settings_of,
)


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
    offered: Offered = field(default_factory=Offered)  # devices and entities chosen in Configure
    store: Store[dict[str, Any]] = field(init=False)
    probe_store: Store[dict[str, Any]] = field(init=False)
    watches: dict[str, dict[str, Any]] = field(default_factory=dict)
    # removed watches' setups (paints, rooms, settings), kept REMOVED_KEPT_DAYS for the next pairing
    removed: dict[str, dict[str, Any]] = field(default_factory=dict)
    pairings: dict[str, Pairing] = field(default_factory=dict)
    starts: dict[str, deque[float]] = field(default_factory=dict)
    seen_seqs: dict[str, deque[Any]] = field(default_factory=dict)
    volume_at: dict[str, float] = field(default_factory=dict)  # monotonic time of each watch's last volume twist
    probes: deque[dict[str, Any]] = field(default_factory=deque)
    probe_sizes: deque[int] = field(default_factory=deque)  # characters per kept result, for the size cap

    def __post_init__(self) -> None:  # noqa: D105
        self.store = Store(self.hass, STORAGE_VERSION, STORAGE_KEY)
        self.probe_store = Store(self.hass, STORAGE_VERSION, PROBES_STORAGE_KEY)

    async def async_load(self) -> None:
        data = await self.store.async_load() or {}
        self.watches = data.get("watches", {})
        self.removed = data.get("removed", {})
        probes = await self.probe_store.async_load() or {}
        for record in probes.get("probes", []):
            self._keep_probe(record)

    async def _async_save(self) -> None:
        cutoff = time.time() - REMOVED_KEPT_DAYS * 86400
        self.removed = {k: v for k, v in self.removed.items() if v.get("removed_at", 0) >= cutoff}
        await self.store.async_save({"watches": self.watches, "removed": self.removed})

    # ------------------------------------------------------------ pairing
    def allow_start(self, client: str, now: float | None = None) -> bool:
        """Rate-limit pairing requests per client address."""
        now = time.monotonic() if now is None else now
        self._expire(now)
        if len(self.pairings) >= PAIRINGS_PENDING_MAX:
            return False
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
            # shown in a notification (markdown): plain characters only
            watch_name=re.sub(r"[^\w \-.'()]", "", watch_name or "").strip()[:WATCH_NAME_MAX] or "Watch",
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
        async_dispatcher_send(self.hass, SIGNAL_WATCH_ADDED, watch_id)
        return "ok", watch, token

    # ------------------------------------------------------------ carrying a setup over
    def setups_for(self, watch_id: str) -> list[dict[str, Any]]:
        """Setups a newly paired watch could take over: other paired watches, then removed ones."""
        out = [
            {"id": wid, "name": w["name"], "paints": len(w.get("paints", {})), "rooms": len(w.get("rooms", {})), "removed": False}
            for wid, w in self.watches.items()
            if wid != watch_id and (w.get("paints") or w.get("rooms"))
        ]
        out += [
            {"id": wid, "name": r["name"], "paints": len(r.get("paints", {})), "rooms": len(r.get("rooms", {})), "removed": True}
            for wid, r in sorted(self.removed.items(), key=lambda kv: -kv[1].get("removed_at", 0))
        ]
        return out

    async def async_take_over(self, watch_id: str, from_id: str) -> str | None:
        """Give the watch `watch_id` (just paired) the setup of `from_id`; returns its watch id now.

        From a paired watch: the new token moves onto that watch's record (same id, device and
        entities, so automations keep working) and the just-paired record goes. From a removed
        watch: its paints, rooms and settings are copied in. None if `from_id` is unknown or the
        watch paired too long ago.
        """
        new = self.watches.get(watch_id)
        if new is None or from_id == watch_id:
            return None
        # only just after pairing: a watch's token can't be used later to take another watch's place
        if time.time() - float(new.get("paired_at") or 0) > TAKE_OVER_WINDOW:
            return None
        if from_id in self.watches:
            old = self.watches[from_id]
            old["token_hash"] = new["token_hash"]
            old["paired_at"] = new["paired_at"]
            del self.watches[watch_id]
            self.seen_seqs.pop(watch_id, None)
            dev_reg = dr.async_get(self.hass)
            device = dev_reg.async_get_device_by_identifier((DOMAIN, watch_id), self.entry_id)
            if device is not None:
                dev_reg.async_remove_device(device.id)
            await self._async_save()
            async_dispatcher_send(self.hass, signal_watch_updated(from_id))
            return from_id
        backup = self.removed.pop(from_id, None)
        if backup is None:
            return None
        for section in SECTIONS:
            if section in backup:
                new[section] = backup[section]
                new[f"{section}_rev"] = new.get(f"{section}_rev", 0) + 1
        await self._async_save()
        async_dispatcher_send(self.hass, signal_watch_updated(watch_id))
        return watch_id

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
            watch = self.watches.pop(wid, None)
            if watch and (watch.get("paints") or watch.get("rooms")):
                # kept a while: a watch paired again (or a new one) can take this setup over
                self.removed[wid] = {
                    "name": watch["name"],
                    "removed_at": time.time(),
                    **{k: watch[k] for k in ("settings", "paints", "rooms") if k in watch},
                }
            self.seen_seqs.pop(wid, None)
        kept = [p for p in self.probes if p.get("watch_id") not in watch_ids]
        if len(kept) != len(self.probes):
            self.probes.clear()
            self.probe_sizes.clear()
            for record in kept:
                self._keep_probe(record)
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

    async def async_change_section(self, watch_id: str, section: str, changes: dict[str, Any]) -> int:
        """Some entries of paints or rooms changed on the watch ({key: new value, or None to remove}):
        merged into Home Assistant's copy, so the watch sends only what it changed."""
        merged = dict(self.watches[watch_id].get(section) or {})
        for key, value in list(changes.items())[:ROOMS_MAX if section == "rooms" else PAINTS_MAX_DEVICES]:
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
        clean = clean_rooms(merged) if section == "rooms" else clean_paints(merged)
        return await self._async_set(watch_id, section, clean)

    async def async_update_settings(self, watch_id: str, values: dict[str, Any]) -> int:
        """Some settings changed ({group: {field: value}}, checked here): from the watch,
        the Zepp app's settings page or an entity. Returns the new revision."""
        settings = settings_of(self.watches[watch_id])
        for group, changed in clean_settings(values).items():
            settings[group].update(changed)
        return await self._async_set(watch_id, "settings", settings)

    async def async_set_detailed_diagnostics(self, watch_id: str, on: bool) -> int:
        """Turn detailed diagnostics on (for DETAILED_DIAGNOSTICS_FOR) or off. Home Assistant only:
        a watch can't turn it on itself."""
        settings = settings_of(self.watches[watch_id])
        settings["diagnostics"] = {"detailed": on, "until": time.time() + DETAILED_DIAGNOSTICS_FOR if on else 0.0}
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
        self._keep_probe(record)
        self._save_probes()
        return record

    def _keep_probe(self, record: dict[str, Any]) -> None:
        """Keep the newest PROBES_KEPT results, no more than PROBES_MAX_CHARS together, none older
        than PROBES_MAX_AGE."""
        received = dt_util.parse_datetime(str(record.get("received") or ""))
        oldest = dt_util.utcnow().timestamp() - PROBES_MAX_AGE
        if received is not None and received.timestamp() < oldest:
            return
        self.probes.append(record)
        self.probe_sizes.append(len(json.dumps(record, default=str)))
        while self.probes and (
            len(self.probes) > PROBES_KEPT
            or (len(self.probes) > 1 and sum(self.probe_sizes) > PROBES_MAX_CHARS)
            or self._age(self.probes[0]) > PROBES_MAX_AGE
        ):
            self.probes.popleft()
            self.probe_sizes.popleft()

    @staticmethod
    def _age(record: dict[str, Any]) -> float:
        received = dt_util.parse_datetime(str(record.get("received") or ""))
        return 0.0 if received is None else dt_util.utcnow().timestamp() - received.timestamp()

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
        self.probe_sizes.clear()
        await self.store.async_remove()
        await self.probe_store.async_remove()

    def volume_allowed(self, watch_id: str) -> bool:
        """At most one volume twist per VOLUME_MIN_INTERVAL from a watch (a safety net for loud speakers)."""
        now = time.monotonic()
        last = self.volume_at.get(watch_id)
        if last is not None and now - last < VOLUME_MIN_INTERVAL:
            return False
        self.volume_at[watch_id] = now
        return True

    def first_time(self, watch_id: str, seq: Any) -> bool:
        """True the first time a command sequence number is seen (retries are dropped)."""
        if seq is None:
            return True
        q = self.seen_seqs.setdefault(watch_id, deque(maxlen=64))
        if seq in q:
            return False
        q.append(seq)
        return True
