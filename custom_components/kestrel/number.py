"""Numbers for each paired watch: the instant-toggle delay, volume limits and the current gesture's thresholds.

The thresholds come from calibrating on the watch; these let them be nudged
(raise: fewer accidental triggers; lower: easier). They apply to the gesture
chosen now, and are disabled by default: most people never need them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.number import NumberDeviceClass, NumberEntity, NumberEntityDescription, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import KestrelEntity, add_per_watch
from .watchdata import DWELL_SECONDS, VOLUME_MAX, VOLUME_STEP, settings_of, thresholds
from .watches import Watches

PARALLEL_UPDATES = 0


def _threshold(channel: str) -> Callable[[dict[str, Any]], float | None]:
    return lambda s: (thresholds(s["gesture"]) or {}).get(channel)


def _set_threshold(channel: str) -> Callable[[dict[str, Any], float], dict[str, Any]]:
    def change(s: dict[str, Any], value: float) -> dict[str, Any]:
        g = s["gesture"]
        current = thresholds(g) or {"gyro": None, "jolt": None}
        return {"gesture": {"calibrations": {**g["calibrations"], g["kind"]: {**current, channel: value}}}}

    return change


@dataclass(frozen=True, kw_only=True)
class WatchNumberDescription(NumberEntityDescription):
    """value(settings) -> number; change(settings, number) -> settings update."""

    value: Callable[[dict[str, Any]], float | None]
    change: Callable[[dict[str, Any], float], dict[str, Any]]


NUMBERS: tuple[WatchNumberDescription, ...] = (
    WatchNumberDescription(
        key="instant_toggle_delay",
        translation_key="instant_toggle_delay",
        device_class=NumberDeviceClass.DURATION,
        entity_category=EntityCategory.CONFIG,
        native_min_value=DWELL_SECONDS[0],
        native_max_value=DWELL_SECONDS[1],
        native_step=0.5,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        mode=NumberMode.SLIDER,
        value=lambda s: s["dwell"]["seconds"],
        change=lambda s, v: {"dwell": {"seconds": v}},
    ),
    WatchNumberDescription(
        key="volume_limit",
        translation_key="volume_limit",
        entity_category=EntityCategory.CONFIG,
        native_min_value=VOLUME_MAX[0],
        native_max_value=VOLUME_MAX[1],
        native_step=5,
        native_unit_of_measurement=PERCENTAGE,
        mode=NumberMode.SLIDER,
        value=lambda s: s["volume"]["max"],
        change=lambda s, v: {"volume": {"max": v}},
    ),
    WatchNumberDescription(
        key="volume_step_limit",
        translation_key="volume_step_limit",
        entity_category=EntityCategory.CONFIG,
        native_min_value=VOLUME_STEP[0],
        native_max_value=VOLUME_STEP[1],
        native_step=5,
        native_unit_of_measurement=PERCENTAGE,
        mode=NumberMode.SLIDER,
        value=lambda s: s["volume"]["step"],
        change=lambda s, v: {"volume": {"step": v}},
    ),
    WatchNumberDescription(
        key="gesture_gyro",
        translation_key="gesture_gyro",
        entity_category=EntityCategory.CONFIG,
        entity_registry_enabled_default=False,
        native_min_value=1,
        native_max_value=5000,
        native_step=1,
        mode=NumberMode.BOX,
        value=_threshold("gyro"),
        change=_set_threshold("gyro"),
    ),
    WatchNumberDescription(
        key="gesture_jolt",
        translation_key="gesture_jolt",
        entity_category=EntityCategory.CONFIG,
        entity_registry_enabled_default=False,
        native_min_value=1,
        native_max_value=5000,
        native_step=1,
        mode=NumberMode.BOX,
        value=_threshold("jolt"),
        change=_set_threshold("jolt"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(
        hass, entry, async_add_entities, lambda watches, wid: [WatchNumber(watches, wid, d) for d in NUMBERS]
    )


class WatchNumber(KestrelEntity, NumberEntity):
    entity_description: WatchNumberDescription

    @property
    def native_value(self) -> float | None:
        return self.entity_description.value(settings_of(self.watch))

    async def async_set_native_value(self, value: float) -> None:
        change = self.entity_description.change(settings_of(self.watch), value)
        await self.async_update_settings(change)
