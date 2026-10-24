"""Selects for each paired watch: the gesture, and where the current room comes from.

Each gesture keeps its own calibration (watchdata.py), so switching is instant;
a snap or tap that was never calibrated asks for calibration on the watch.
The watch picks up a change on its next sync.
"""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import KestrelEntity, add_per_watch
from .watchdata import GESTURE_KINDS, ROOM_SOURCES, settings_of
from .watches import Watches

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class WatchSelectDescription(SelectEntityDescription):
    """A fixed-choice setting: settings[group][field]."""

    group: str
    field: str


SELECTS: tuple[WatchSelectDescription, ...] = (
    WatchSelectDescription(
        key="gesture_kind",
        translation_key="gesture",
        entity_category=EntityCategory.CONFIG,
        options=list(GESTURE_KINDS),
        group="gesture",
        field="kind",
    ),
    WatchSelectDescription(
        key="room_source",
        translation_key="room_source",
        entity_category=EntityCategory.CONFIG,
        options=list(ROOM_SOURCES),
        group="room",
        field="source",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(hass, entry, async_add_entities, lambda watches, wid: [WatchSelect(watches, wid, d) for d in SELECTS])


class WatchSelect(KestrelEntity, SelectEntity):
    entity_description: WatchSelectDescription

    @property
    def current_option(self) -> str:
        d = self.entity_description
        return str(settings_of(self.watch)[d.group][d.field])

    async def async_select_option(self, option: str) -> None:
        d = self.entity_description
        await self.async_update_settings({d.group: {d.field: option}})
