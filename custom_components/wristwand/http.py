"""HTTP API used by the WristWand phone service.

Watches don't use Home Assistant user tokens. Pairing gives each watch its own
token, sent as X-WristWand-Token, which only works on these endpoints.

  GET  /api/wristwand/info            no auth: lets the phone find this HA
  POST /api/wristwand/pair            no auth, rate limited: start pairing (HA shows a code)
  POST /api/wristwand/pair/confirm    no auth, limited attempts: code -> watch token
  GET  /api/wristwand/targets         watch token: what can be painted
  POST /api/wristwand/fire            watch token: run an action on a target
  POST /api/wristwand/probe           watch token: a measurement result -> wristwand_probe event
"""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import Any

from aiohttp import web

from homeassistant.components import persistent_notification
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.network import NoURLAvailableError, get_url

from .const import DOMAIN, EVENT_FIRED, EVENT_PROBE, NAME, PAIRING_TTL, SUPPORTED_DOMAINS, TOKEN_HEADER
from .targets import list_targets, service_call
from .watches import Watches

_LOGGER = logging.getLogger(__name__)


def _watches(hass: HomeAssistant) -> Watches | None:
    return hass.data.get(DOMAIN)


def _error(message: str, status: HTTPStatus) -> web.Response:
    return web.json_response({"message": message}, status=status)


def _notification_id(pairing_id: str) -> str:
    return f"{DOMAIN}_pair_{pairing_id}"


def _urls(hass: HomeAssistant) -> dict[str, str | None]:
    out: dict[str, str | None] = {"internal": None, "external": None}
    try:
        out["internal"] = get_url(hass, allow_external=False, allow_cloud=False)
    except NoURLAvailableError:
        pass
    try:
        out["external"] = get_url(hass, allow_internal=False, prefer_cloud=True)
    except NoURLAvailableError:
        pass
    return out


class _WatchView(HomeAssistantView):
    """Base for endpoints that take a watch token instead of HA auth."""

    requires_auth = False

    def _authorize(self, request: web.Request) -> tuple[HomeAssistant, Watches, dict[str, Any]] | web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("WristWand is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
        watch = watches.by_token(request.headers.get(TOKEN_HEADER))
        if watch is None:
            return _error("Unknown watch: pair it again", HTTPStatus.UNAUTHORIZED)
        return hass, watches, watch


class InfoView(HomeAssistantView):
    url = "/api/wristwand/info"
    name = "api:wristwand:info"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        if _watches(hass) is None:
            return _error("WristWand is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
        version = hass.data.get(f"{DOMAIN}_version", "")
        return web.json_response({"name": NAME, "version": version, "ha_name": hass.config.location_name})


class PairView(HomeAssistantView):
    url = "/api/wristwand/pair"
    name = "api:wristwand:pair"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("WristWand is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
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
                f"The watch **{pairing.watch_name}** wants to pair with WristWand.\n\n"
                f"Enter this code on the watch: **{pairing.code}**\n\n"
                f"The code works for {PAIRING_TTL // 60} minutes. If you didn't start this, ignore it."
            ),
            title="WristWand pairing code",
            notification_id=_notification_id(pairing.pairing_id),
        )
        return web.json_response({"pairing_id": pairing.pairing_id, "expires_in": PAIRING_TTL})


class PairConfirmView(HomeAssistantView):
    url = "/api/wristwand/pair/confirm"
    name = "api:wristwand:pair:confirm"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        watches = _watches(hass)
        if watches is None:
            return _error("WristWand is not set up in Home Assistant", HTTPStatus.NOT_FOUND)
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
    url = "/api/wristwand/targets"
    name = "api:wristwand:targets"

    async def get(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, _, _ = auth
        return web.json_response({"targets": list_targets(hass)})


class FireView(_WatchView):
    url = "/api/wristwand/fire"
    name = "api:wristwand:fire"

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
        if target.split(".", 1)[0] not in SUPPORTED_DOMAINS or hass.states.get(target) is None:
            return _error(f"Unknown target {target}", HTTPStatus.NOT_FOUND)
        if not watches.first_time(watch["id"], body.get("seq")):
            state = hass.states.get(target)
            return web.json_response({"ok": True, "duplicate": True, "state": state.state if state else None})

        call = service_call(hass, target, action, body.get("value"), bool(body.get("confirmed")))
        if call is None:
            return web.json_response({"ok": False, "needsConfirm": True})
        domain, service, data = call
        context = Context()
        try:
            await hass.services.async_call(domain, service, data, blocking=True, context=context)
        except HomeAssistantError as err:
            return web.json_response({"ok": False, "error": str(err)})
        hass.bus.async_fire(
            EVENT_FIRED,
            {"watch_id": watch["id"], "watch_name": watch["name"], "target": target, "action": action},
            context=context,
        )
        state = hass.states.get(target)
        return web.json_response({"ok": True, "state": state.state if state else None})


class ProbeView(_WatchView):
    """Measurement results from the watch's Probes, as wristwand_probe events."""

    url = "/api/wristwand/probe"
    name = "api:wristwand:probe"

    async def post(self, request: web.Request) -> web.Response:
        auth = self._authorize(request)
        if isinstance(auth, web.Response):
            return auth
        hass, _, watch = auth
        try:
            body = await request.json()
        except ValueError:
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        if not isinstance(body, dict):
            return _error("Bad request", HTTPStatus.BAD_REQUEST)
        hass.bus.async_fire(EVENT_PROBE, {"watch_id": watch["id"], "watch_name": watch["name"], **body})
        return web.json_response({"ok": True})


VIEWS = (InfoView, PairView, PairConfirmView, TargetsView, FireView, ProbeView)
