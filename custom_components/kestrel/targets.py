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

# Sent to a watch at most; the rest are left out (the kestrel label narrows the list).
MAX_TARGETS = 1000


def _label_id(hass: HomeAssistant) -> str | None:
    for label in lr.async_get(hass).async_list_labels():
        if label.name.strip().lower() == LABEL_NAME:
            return label.label_id
    return None


def list_targets(hass: HomeAssistant, limit: int | None = MAX_TARGETS) -> list[dict[str, Any]]:
    """Entities a watch can paint.

    If any entity (or its device) carries the `kestrel` label, only labelled ones;
    otherwise every supported entity that isn't hidden, disabled, or a device's
    configuration or diagnostic entity (restart buttons, firmware switches).
    Grouped by area; at most `limit` (None for all).
    """
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    area_reg = ar.async_get(hass)
    label_id = _label_id(hass)

    def labelled(entry: er.RegistryEntry | None, device_labels: set[str]) -> bool:
        return bool(label_id) and ((entry is not None and label_id in entry.labels) or label_id in device_labels)

    rows: list[tuple[dict[str, Any], bool]] = []
    for state in hass.states.async_all(SUPPORTED_DOMAINS):
        entry = ent_reg.async_get(state.entity_id)
        if entry is not None and (entry.disabled_by or entry.hidden_by or entry.entity_category):
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
                    "area_id": area.id if area else None,
                    "dimmable": domain == "light" and any(m != "onoff" for m in modes),
                    "confirm": domain in CONFIRM_DOMAINS,
                },
                labelled(entry, set(device.labels) if device else set()),
            )
        )

    if any(is_labelled for _, is_labelled in rows):
        rows = [r for r in rows if r[1]]
    targets = [t for t, _ in rows]
    targets.sort(key=lambda t: ((t["area"] or "￿").lower(), t["name"].lower()))
    return targets if limit is None else targets[:limit]


def is_offered(hass: HomeAssistant, entity_id: str) -> bool:
    """Whether list_targets offers this entity (ignoring the size cap), without building the list:
    checked on every trigger, so it looks at this entity and the labelled entries only."""
    state = hass.states.get(entity_id)
    if state is None or state.domain not in SUPPORTED_DOMAINS:
        return False
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get(entity_id)
    if entry is not None and (entry.disabled_by or entry.hidden_by or entry.entity_category):
        return False
    label_id = _label_id(hass)
    if not label_id:
        return True
    dev_reg = dr.async_get(hass)

    def labelled(e: er.RegistryEntry | None) -> bool:
        if e is None:
            return False
        if label_id in e.labels:
            return True
        device = dev_reg.async_get(e.device_id) if e.device_id else None
        return device is not None and label_id in device.labels

    if labelled(entry):
        return True
    # the label narrows the list only if some offered entity carries it (as list_targets does)
    candidates = list(er.async_entries_for_label(ent_reg, label_id))
    for device in dr.async_entries_for_label(dev_reg, label_id):
        candidates.extend(er.async_entries_for_device(ent_reg, device.id))
    return not any(
        e.domain in SUPPORTED_DOMAINS
        and hass.states.get(e.entity_id) is not None
        and not (e.disabled_by or e.hidden_by or e.entity_category)
        for e in candidates
    )


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
