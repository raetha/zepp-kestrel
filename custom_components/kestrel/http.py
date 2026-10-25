"""HTTP API used by the Kestrel phone service.

Every request a watch makes also updates what Home Assistant shows about it
(last seen, the address it used; see sensor.py).

Kestrel only works on the home network (or a VPN into it): every endpoint
refuses requests through Home Assistant Cloud or from a public address. The
point is a device in front of you, so there's no reason to reach it from
outside, and a stolen watch token is useless from the internet.

Watches don't use Home Assistant user tokens. Pairing gives each watch its own
token, sent as X-Kestrel-Token, which only works on these endpoints.

  GET  /api/kestrel/info            no auth: lets the phone find this HA
  POST /api/kestrel/pair            no auth, rate limited: start pairing (HA shows a code)
  POST /api/kestrel/pair/confirm    no auth, limited attempts: code -> watch token
  GET  /api/kestrel/targets         watch token: what can be painted
  GET  /api/kestrel/sync            watch token: targets, areas, settings, paints, rooms (with revisions); ?v=<app version>
  POST /api/kestrel/paints          watch token: the watch's paints after a change
  POST /api/kestrel/rooms           watch token: the watch's room fingerprints after calibrating
  POST /api/kestrel/settings        watch token: changed settings ({group: {field: value}}), from the watch or the
                                      Zepp app's settings page
  GET  /api/kestrel/room            watch token: the current room from a sensor, if configured; ?here=<area id> reports
                                      the room the watch placed itself in
  POST /api/kestrel/fire            watch token: run an action on a target the watch is offered
  POST /api/kestrel/probe           watch token: a measurement result -> kestrel_probe event
"""

from __future__ import annotations

import hashlib
from ipaddress import ip_address
import json
import logging
from http import HTTPStatus
from typing import Any, cast

from aiohttp import web

from homeassistant.components import persistent_notification
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.network import NoURLAvailableError, get_url, is_cloud_connection
from homeassistant.util.network import is_local
from homeassistant.util import dt as dt_util

from .const import (
    AUTO_PROBES,
    DOMAIN,
    EVENT_FIRED,
    EVENT_PROBE,
    NAME,
    PAIRING_TTL,
    PROBE_MAX_BYTES,
    SUPPORTED_DOMAINS,
    TOKEN_HEADER,
)
from .targets import MAX_TARGETS, action_fits, is_offered, list_targets, service_call, volume_call
from .watchdata import SECTIONS, areas, current_room, settings_of
from .watches import Watches

_LOGGER = logging.getLogger(__name__)


def _watches(hass: HomeAssistant) -> Watches | None:
    """The loaded entry's paired watches, or None while Kestrel isn't set up."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    return cast(Watches, entries[0].runtime_data) if entries else None


def _error(message: str, status: HTTPStatus) -> web.Response:
    return web.json_response({"message": message}, status=status)


NOT_HOME = "Kestrel only works on your home network"


def _from_home(hass: HomeAssistant, request: web.Request) -> bool:
    """A request from the local network: not through Home Assistant Cloud, from a private or loopback address."""
    if is_cloud_connection(hass):
        return False
    try:
        return is_local(ip_address(request.remote or ""))
    except ValueError:
        return False


def _room(hass: HomeAssistant, area_id: Any) -> dict[str, str] | None:
    """{id, name} of an area a watch reported, or None if there's no such area."""
    area = ar.async_get(hass).async_get_area(str(area_id)) if area_id else None
    return {"id": area.id, "name": area.name} if area else None


def _notification_id(pairing_id: str) -> str:
    return f"{DOMAIN}_pair_{pairing_id}"


def _urls(hass: HomeAssistant) -> dict[str, str | None]:
    """Home Assistant's home-network address, for the phone to keep alongside the one it paired with."""
    try:
        return {"internal": get_url(hass, allow_external=False, allow_cloud=False)}
    except NoURLAvailableError:
        return {"internal": None}


class _WatchView(HomeAssistantView):
    """Base for endpoints that take a watch token instead of HA auth."""

    requires_auth = False

    def _authorize(self, request: web.Request) -> tuple[HomeAssistant, Watches, dict[str, Any]] | web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("Kestrel is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
        if not _from_home(hass, request):
            return _error(NOT_HOME, HTTPStatus.FORBIDDEN)
        watch = watches.by_token(request.headers.get(TOKEN_HEADER))
        if watch is None:
            return _error("Unknown watch: pair it again", HTTPStatus.UNAUTHORIZED)
        watches.note_status(watch["id"], address=f"{request.scheme}://{request.host}")
        return hass, watches, watch


class InfoView(HomeAssistantView):
    url = "/api/kestrel/info"
    name = "api:kestrel:info"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("Kestrel is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
        if not _from_home(hass, request):
            return _error(NOT_HOME, HTTPStatus.FORBIDDEN)
        return web.json_response({"name": NAME, "version": watches.version, "ha_name": hass.config.location_name})


class PairView(HomeAssistantView):
    url = "/api/kestrel/pair"
    name = "api:kestrel:pair"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("Kestrel is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
        if not _from_home(hass, request):
            return _error(NOT_HOME, HTTPStatus.FORBIDDEN)
        if not watches.allow_start(request.remote or "?"):
            return _error("Too many pairing requests: wait a few minutes", HTTPStatus.TOO_MANY_REQUESTS)
        try:
            body = await request.json()
        except ValueError:
            body = {}
        pairing = watches.start_pairing(str(body.get("watch_name") or "Watch"))
        persistent_notification.async_create(
            hass,
            (
                f"The watch **{pairing.watch_name}** wants to pair with Kestrel.\n\n"
                f"Enter this code on the watch: **{pairing.code}**\n\n"
                f"The code works for {PAIRING_TTL // 60} minutes. If you didn't start this, ignore it."
            ),
            title="Kestrel pairing code",
            notification_id=_notification_id(pairing.pairing_id),
        )
        return web.json_response({"pairing_id": pairing.pairing_id, "expires_in": PAIRING_TTL})


class PairConfirmView(HomeAssistantView):
    url = "/api/kestrel/pair/confirm"
    name = "api:kestrel:pair:confirm"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("Kestrel is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
        if not _from_home(hass, request):
            return _error(NOT_HOME, HTTPStatus.FORBIDDEN)
        try:
            body = await request.json()
        except ValueError:
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        pairing_id = str(body.get("pairing_id") or "")
        status, watch, token = await watches.async_confirm(pairing_id, str(body.get("code") or ""))
        if status == "wrong":
            return _error("Wrong code", HTTPStatus.FORBIDDEN)
        if status == "gone":
            persistent_notification.async_dismiss(hass, _notification_id(pairing_id))
            return _error("This pairing has expired: start again", HTTPStatus.GONE)
        persistent_notification.async_dismiss(hass, _notification_id(pairing_id))
        assert watch is not None
        _LOGGER.info("Paired watch %s (%s)", watch["name"], watch["id"])
        return web.json_response(
            {
                "token": token,
                "watch_id": watch["id"],
                "ha_name": hass.config.location_name,
                "urls": _urls(hass),
            }
        )


class TargetsView(_WatchView):
    url = "/api/kestrel/targets"
    name = "api:kestrel:targets"

    async def get(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, watches, _ = auth
        return web.json_response({"targets": list_targets(hass, offered=watches.offered)})


async def _json_object(request: web.Request) -> dict[str, Any] | None:
    try:
        body = await request.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


class SyncView(_WatchView):
    """Everything a watch keeps in sync: targets, areas, settings, paints and rooms.

    The watch syncs on every launch over Bluetooth, so it says what it already
    has and gets only what changed:
      ?have=targets:<hash>,paints:<rev>,rooms:<rev>,settings:<rev>
        a section (or the target and area lists) the watch already has at that
        revision is left out; its revision is still sent.
      ?only=paints,rooms  just those sections (after a change on the watch).
    Targets are sent compactly (sync_targets). `watch_id` lets the watch notice
    it was paired again and start over.
    """

    url = "/api/kestrel/sync"
    name = "api:kestrel:sync"

    async def get(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, watches, watch = auth
        version = request.query.get("v", "").strip()[:40]
        if version:
            watches.note_status(watch["id"], app_version=version)
        synced = watches.synced(watch["id"])
        have = dict(item.split(":", 1) for item in request.query.get("have", "").split(",") if ":" in item)
        only = [x for x in request.query.get("only", "").split(",") if x]

        body: dict[str, Any] = {"watch_id": watch["id"], "room": current_room(hass, synced["settings"])}
        for section in SECTIONS:
            if only and section not in only:
                continue
            rev = synced[f"{section}_rev"]
            body[f"{section}_rev"] = rev
            if have.get(section) != str(rev):
                body[section] = synced[section]
        if not only:
            every = list_targets(hass, limit=None, offered=watches.offered)
            targets, area_list = sync_targets(every[:MAX_TARGETS]), areas(hass)
            digest = hashlib.sha1(json.dumps([targets, area_list], sort_keys=True).encode()).hexdigest()[:12]
            body["targets_hash"] = digest
            if have.get("targets") != digest:
                body.update(targets=targets, areas=area_list)
                if len(every) > MAX_TARGETS:
                    body["targets_total"] = len(every)  # the watch says some were left out
        return web.json_response(body)


def sync_targets(targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Targets as the watch keeps them: id, name, area_id, and flags only when set."""
    out = []
    for t in targets:
        c: dict[str, Any] = {"id": t["id"], "name": t["name"]}
        if t.get("area_id"):
            c["area_id"] = t["area_id"]
        for flag in ("dimmable", "volume", "confirm"):
            if t.get(flag):
                c[flag] = True
        out.append(c)
    return out


class _SectionView(_WatchView):
    """POST {<key>: {...}}: the watch's new copy of one synced section. Paints and rooms also take
    {"changes": {key: value or null}, "base": rev}: only what changed on the watch, merged here,
    and the reply is just the new revision and whether something else had changed since `base`
    ("stale": the watch fetches Home Assistant's copy on its next sync)."""

    key = ""

    async def save(self, watches: Watches, watch_id: str, value: dict[str, Any]) -> int:
        raise NotImplementedError

    async def post(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        _, watches, watch = auth
        body = await _json_object(request)
        changes = body.get("changes") if body else None
        if self.key in ("paints", "rooms") and isinstance(changes, dict):
            before = int(watch.get(f"{self.key}_rev", 0))
            rev = await watches.async_change_section(watch["id"], self.key, changes)
            return web.json_response({"ok": True, "rev": rev, "stale": (body or {}).get("base") != before})
        value = body.get(self.key) if body else None
        if not isinstance(value, dict):
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        rev = await self.save(watches, watch["id"], value)
        return web.json_response({"ok": True, "rev": rev, **self.result(watches.synced(watch["id"]))})

    def result(self, synced: dict[str, Any]) -> dict[str, Any]:
        return {self.key: synced[self.key]}


class PaintsView(_SectionView):
    """The watch's painted spots, after painting or a correction."""

    url = "/api/kestrel/paints"
    name = "api:kestrel:paints"
    key = "paints"

    async def save(self, watches: Watches, watch_id: str, value: dict[str, Any]) -> int:
        return await watches.async_save_paints(watch_id, value)


class RoomsView(_SectionView):
    """The watch's room fingerprints, after calibrating a room."""

    url = "/api/kestrel/rooms"
    name = "api:kestrel:rooms"
    key = "rooms"

    async def save(self, watches: Watches, watch_id: str, value: dict[str, Any]) -> int:
        return await watches.async_save_rooms(watch_id, value)


class SettingsView(_SectionView):
    """Changed settings, from the watch (gesture calibration and choice, instant toggle) or the
    Zepp app's settings page. Each field is checked; the reply has all settings."""

    url = "/api/kestrel/settings"
    name = "api:kestrel:settings"
    key = "settings"

    async def save(self, watches: Watches, watch_id: str, value: dict[str, Any]) -> int:
        return await watches.async_update_settings(watch_id, value)

    def result(self, synced: dict[str, Any]) -> dict[str, Any]:
        return {"settings": synced["settings"]}


class RoomView(_WatchView):
    """The current room, when a sensor provides it (settings: room source = sensor)."""

    url = "/api/kestrel/room"
    name = "api:kestrel:room"

    async def get(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, watches, watch = auth
        here = _room(hass, request.query.get("here"))
        if here:
            watches.note_status(watch["id"], room=here)
        return web.json_response({"room": current_room(hass, watches.synced(watch["id"])["settings"])})


class FireView(_WatchView):
    url = "/api/kestrel/fire"
    name = "api:kestrel:fire"

    async def post(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, watches, watch = auth
        try:
            body = await request.json()
        except ValueError:
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        target = str(body.get("target") or "")
        action = str(body.get("action") or "toggle")
        # only what the watch is offered: supported, not hidden or disabled, and chosen in Configure if anything is
        if not is_offered(hass, target, watches.offered):
            return _error(f"Unknown target {target}", HTTPStatus.NOT_FOUND)
        if not watches.first_time(watch["id"], body.get("seq")):
            state = hass.states.get(target)
            return web.json_response({"ok": True, "duplicate": True, "state": state.state if state else None})

        if not action_fits(action, target):
            return _error(f"Can't {action} {target}", HTTPStatus.BAD_REQUEST)
        volume: tuple[int, bool] | None = None
        if action == "volume":
            # twisting at a media player: limited per twist, capped, and at most one twist a second
            if not watches.volume_allowed(watch["id"]):
                return web.json_response({"ok": False, "error": "Too fast: one twist a second"})
            vcall = volume_call(hass, target, body.get("value"), watches.synced(watch["id"])["settings"]["volume"])
            if vcall is None:
                return web.json_response({"ok": False, "error": "It doesn't report its volume"})
            domain, service, data = "media_player", "volume_set", vcall[0]
            volume = (vcall[1], vcall[2])
        else:
            call = service_call(hass, target, action, body.get("value"), bool(body.get("confirmed")))
            if call is None:
                return web.json_response({"ok": False, "needsConfirm": True})
            domain, service, data = call
        context = Context()
        try:
            await hass.services.async_call(domain, service, data, blocking=True, context=context)
        except HomeAssistantError as err:
            return web.json_response({"ok": False, "error": str(err)})
        state = hass.states.get(target)
        room = _room(hass, body.get("room"))
        watches.note_status(
            watch["id"],
            room=room,
            last_fired={
                "entity_id": target,
                "name": state.name if state else target,
                "action": action,
                "via": str(body.get("via") or "")[:16] or None,
                "room": room["name"] if room else None,
                "at": dt_util.utcnow().isoformat(),
            },
        )
        hass.bus.async_fire(
            EVENT_FIRED,
            {
                "watch_id": watch["id"],
                "watch_name": watch["name"],
                "target": target,
                "action": action,
                "via": str(body.get("via") or "")[:16] or None,
                "area_id": room["id"] if room else None,
            },
            context=context,
        )
        state = hass.states.get(target)
        reply: dict[str, Any] = {"ok": True, "state": state.state if state else None}
        if state is not None and state.domain == "light" and state.attributes.get("brightness") is not None:
            reply["brightness"] = round(state.attributes["brightness"] * 100 / 255)
        if volume is not None:
            reply["volume"], reply["limited"] = volume
        return web.json_response(reply)


def _has_error(trail: Any) -> bool:
    return isinstance(trail, list) and any(isinstance(e, list) and len(e) > 1 and e[1] == "error" for e in trail)


class ProbeView(_WatchView):
    """Results from the watch, kept for diagnostics. Probes run on purpose (More → Probes) are
    always kept and fired as kestrel_probe events; what the watch records as it's used (AUTO_PROBES:
    aim traces, its trail, room scans) only with detailed diagnostics on, and never as events."""

    url = "/api/kestrel/probe"
    name = "api:kestrel:probe"

    async def post(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, watches, watch = auth
        if (request.content_length or 0) > PROBE_MAX_BYTES:
            return _error("Too large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        raw = await request.read()
        if len(raw) > PROBE_MAX_BYTES:
            return _error("Too large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            body = json.loads(raw)
        except ValueError:
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        if not isinstance(body, dict):
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        test = body.get("test")
        if test in AUTO_PROBES:
            detailed = settings_of(watch)["diagnostics"]["detailed"]
            if detailed or (test == "trail" and _has_error(body.get("trail"))):
                watches.add_probe(watch, body)
                return web.json_response({"ok": True, "kept": True})
            return web.json_response({"ok": True, "kept": False})
        hass.bus.async_fire(EVENT_PROBE, watches.add_probe(watch, body))
        return web.json_response({"ok": True, "kept": True})


VIEWS = (
    InfoView,
    PairView,
    PairConfirmView,
    TargetsView,
    SyncView,
    PaintsView,
    RoomsView,
    SettingsView,
    RoomView,
    FireView,
    ProbeView,
)
