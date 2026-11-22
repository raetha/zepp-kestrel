"""Sensors for each paired watch: what it last triggered, its room, and how it's connected."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .entity import KestrelEntity, add_per_watch
from .watches import Watches

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class WatchSensorDescription(SensorEntityDescription):
    """value(watch record) -> state; attrs(watch record) -> extra attributes."""

    value: Callable[[dict[str, Any]], Any]
    attrs: Callable[[dict[str, Any]], dict[str, Any] | None] = lambda _w: None


def _status(w: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], w.get("status", {}))


def _time(value: str | None) -> datetime | None:
    return dt_util.parse_datetime(value) if value else None


def _fired_attrs(w: dict[str, Any]) -> dict[str, Any] | None:
    fired = _status(w).get("last_fired")
    if not fired:
        return None
    return {k: fired.get(k) for k in ("entity_id", "action", "via", "room", "at")}


def _versions(w: dict[str, Any]) -> dict[str, Any]:
    """The watch's build next to the phone's: they should be the same build."""
    status = _status(w)
    watch, phone = status.get("app_version"), status.get("phone_version")
    return {"watch_version": watch, "matches_watch": None if not (watch and phone) else watch == phone}


SENSORS: tuple[WatchSensorDescription, ...] = (
    WatchSensorDescription(
        key="last_triggered",
        translation_key="last_triggered",
        value=lambda w: (_status(w).get("last_fired") or {}).get("name"),
        attrs=_fired_attrs,
    ),
    WatchSensorDescription(
        key="room",
        translation_key="room",
        value=lambda w: (_status(w).get("room") or {}).get("name"),
        attrs=lambda w: {"area_id": (_status(w).get("room") or {}).get("id")},
    ),
    WatchSensorDescription(
        key="last_seen",
        translation_key="last_seen",
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda w: _time(_status(w).get("last_seen")),
    ),
    WatchSensorDescription(
        key="address",
        translation_key="address",
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda w: _status(w).get("address"),
    ),
    WatchSensorDescription(
        key="phone_version",
        translation_key="phone_version",
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda w: _status(w).get("phone_version"),
        attrs=lambda w: _versions(w),
    ),
    WatchSensorDescription(
        key="painted_devices",
        translation_key="painted_devices",
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda w: len(w.get("paints", {})),
    ),
    WatchSensorDescription(
        key="calibrated_rooms",
        translation_key="calibrated_rooms",
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda w: len(w.get("rooms", {})),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(
        hass, entry, async_add_entities, lambda watches, wid: [WatchSensor(watches, wid, d) for d in SENSORS]
    )


class WatchSensor(KestrelEntity, SensorEntity):
    entity_description: WatchSensorDescription

    @property
    def native_value(self) -> Any:
        return self.entity_description.value(self.watch)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        return self.entity_description.attrs(self.watch)
