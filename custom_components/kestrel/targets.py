"""What watches can point at, and what pointing at it does."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er

from .const import CONFIRM_DOMAINS, SUPPORTED_DOMAINS

# Sent to a watch at most; the rest are left out (choosing devices in Configure narrows the list).
MAX_TARGETS = 1000


class Offered:
    """The devices and entities chosen in Configure ("Devices for watches").
    Nothing chosen: every supported entity is offered."""

    def __init__(self, devices: list[str] | None = None, entities: list[str] | None = None) -> None:
        self.devices = set(devices or [])
        self.entities = set(entities or [])

    @classmethod
    def from_options(cls, options: Mapping[str, Any]) -> Offered:
        return cls(options.get("devices"), options.get("entities"))

    @property
    def everything(self) -> bool:
        return not self.devices and not self.entities

    def includes(self, entity_id: str, device_id: str | None) -> bool:
        return self.everything or entity_id in self.entities or (device_id is not None and device_id in self.devices)


EVERYTHING = Offered()


def _usable(entry: er.RegistryEntry | None) -> bool:
    """Not hidden, not disabled, and not a device's configuration or diagnostic entity."""
    return entry is None or not (entry.disabled_by or entry.hidden_by or entry.entity_category)


def list_targets(
    hass: HomeAssistant, limit: int | None = MAX_TARGETS, offered: Offered = EVERYTHING
) -> list[dict[str, Any]]:
    """Entities a watch can paint: every supported entity that isn't hidden, disabled, or a
    device's configuration or diagnostic entity (restart buttons, firmware switches), narrowed
    to the chosen devices and entities if any are chosen. Grouped by area; at most `limit`
    (None for all).
    """
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)
    targets: list[dict[str, Any]] = []
    for state in hass.states.async_all(SUPPORTED_DOMAINS):
        entry = ent_reg.async_get(state.entity_id)
        if not _usable(entry):
            continue
        device_id = entry.device_id if entry else None
        if not offered.includes(state.entity_id, device_id):
            continue
        device = dev_reg.async_get(device_id) if device_id else None
        area_id = (entry.area_id if entry else None) or (device.area_id if device else None)
        area = area_reg.async_get_area(area_id) if area_id else None
        domain = state.domain
        modes = state.attributes.get("supported_color_modes") or []
        targets.append(
            {
                "id": state.entity_id,
                "name": state.name,
                "domain": domain,
                "area": area.name if area else None,
                "area_id": area.id if area else None,
                "dimmable": domain == "light" and any(m != "onoff" for m in modes),
                "volume": domain == "media_player"
                and bool(state.attributes.get("supported_features", 0) & MediaPlayerEntityFeature.VOLUME_SET),
                "confirm": domain in CONFIRM_DOMAINS,
            }
        )
    targets.sort(key=lambda t: ((t["area"] or "\uffff").lower(), t["name"].lower()))
    return targets if limit is None else targets[:limit]


def is_offered(hass: HomeAssistant, entity_id: str, offered: Offered = EVERYTHING) -> bool:
    """Whether list_targets offers this entity (ignoring the size cap), without building the list:
    checked on every trigger, so it looks at this one entity only."""
    state = hass.states.get(entity_id)
    if state is None or state.domain not in SUPPORTED_DOMAINS:
        return False
    entry = er.async_get(hass).async_get(entity_id)
    return _usable(entry) and offered.includes(entity_id, entry.device_id if entry else None)


def service_call(
    hass: HomeAssistant, entity_id: str, action: str, value: Any, confirmed: bool
) -> tuple[str, str, dict[str, Any]] | None:
    """The service for an action on an entity, or None if it needs confirming first."""
    domain = entity_id.split(".", 1)[0]
    data: dict[str, Any] = {"entity_id": entity_id}
    if action == "dim" and domain == "light":
        try:
            step = max(-100, min(100, int(value)))
        except (TypeError, ValueError):
            step = 0
        return "light", "turn_on", {**data, "brightness_step_pct": step}
    if domain in CONFIRM_DOMAINS and not confirmed:
        return None
    if domain in ("scene", "script"):
        return domain, "turn_on", data
    if domain in ("button", "input_button"):
        return domain, "press", data
    if domain == "media_player":
        return domain, "media_play_pause", data
    if domain == "lock":
        state = hass.states.get(entity_id)
        return domain, ("unlock" if state is not None and state.state == "locked" else "lock"), data
    return "homeassistant", "toggle", data


def volume_call(
    hass: HomeAssistant, entity_id: str, value: Any, limits: dict[str, Any]
) -> tuple[dict[str, Any], int, bool] | None:
    """media_player.volume_set data for a twist of `value` percent, the volume it sets (percent) and
    whether a limit held it back; None if the player doesn't report its volume.

    Safety: one twist changes the volume by at most limits["step"] percent, and twisting never raises
    it above limits["max"] percent (if it is already higher, it stays; turning it down always works).
    """
    state = hass.states.get(entity_id)
    current = state.attributes.get("volume_level") if state is not None else None
    if not isinstance(current, (int, float)) or isinstance(current, bool):
        return None
    try:
        wanted = float(value)
    except (TypeError, ValueError):
        wanted = 0.0
    step = max(-limits["step"], min(limits["step"], wanted))
    level = current + step / 100
    if step > 0:
        level = min(level, max(current, limits["max"] / 100))
    level = round(max(0.0, min(1.0, level)), 2)
    limited = abs(step) < abs(wanted) or (step > 0 and level < round(current + step / 100, 2))
    return {"entity_id": entity_id, "volume_level": level}, round(level * 100), limited
