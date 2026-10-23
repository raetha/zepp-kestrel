"""What watches can point at, and what pointing at it does."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)

from .const import CONFIRM_DOMAINS, LABEL_NAME, SUPPORTED_DOMAINS

MAX_TARGETS = 300


def _label_id(hass: HomeAssistant) -> str | None:
    for label in lr.async_get(hass).async_list_labels():
        if label.name.strip().lower() == LABEL_NAME:
            return label.label_id
    return None


def list_targets(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Entities a watch can paint.

    If any entity (or its device) carries the `wristwand` label, only labelled ones;
    otherwise every supported entity that isn't hidden or disabled. Grouped by area.
    """
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)
    label_id = _label_id(hass)

    def labelled(entry: er.RegistryEntry | None, device: dr.DeviceEntry | None) -> bool:
        return bool(label_id) and (
            (entry is not None and label_id in entry.labels) or (device is not None and label_id in device.labels)
        )

    rows: list[tuple[dict[str, Any], bool]] = []
    for state in hass.states.async_all(SUPPORTED_DOMAINS):
        entry = ent_reg.async_get(state.entity_id)
        if entry is not None and (entry.disabled_by or entry.hidden_by):
            continue
        device = dev_reg.async_get(entry.device_id) if entry and entry.device_id else None
        area_id = (entry.area_id if entry else None) or (device.area_id if device else None)
        area = area_reg.async_get_area(area_id) if area_id else None
        domain = state.domain
        modes = state.attributes.get("supported_color_modes") or []
        rows.append(
            (
                {
                    "id": state.entity_id,
                    "name": state.name,
                    "domain": domain,
                    "area": area.name if area else None,
                    "dimmable": domain == "light" and any(m != "onoff" for m in modes),
                    "confirm": domain in CONFIRM_DOMAINS,
                },
                labelled(entry, device),
            )
        )

    if any(is_labelled for _, is_labelled in rows):
        rows = [r for r in rows if r[1]]
    targets = [t for t, _ in rows]
    targets.sort(key=lambda t: ((t["area"] or "￿").lower(), t["name"].lower()))
    return targets[:MAX_TARGETS]


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
    if domain == "button":
        return domain, "press", data
    if domain == "media_player":
        return domain, "media_play_pause", data
    if domain == "lock":
        state = hass.states.get(entity_id)
        return domain, ("unlock" if state is not None and state.state == "locked" else "lock"), data
    return "homeassistant", "toggle", data
