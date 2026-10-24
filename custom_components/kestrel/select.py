"""Selects for each paired watch: the gesture, where the current room comes from,
and whose presence away mode follows.

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
NOBODY = "none"


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
AWAY_PERSON = SelectEntityDescription(
    key="away_person", translation_key="away_person", entity_category=EntityCategory.CONFIG
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def make(watches: Watches, wid: str) -> list[KestrelEntity]:
        out: list[KestrelEntity] = [WatchSelect(watches, wid, d) for d in SELECTS]
        out.append(AwayPersonSelect(watches, wid, AWAY_PERSON))
        return out

    add_per_watch(hass, entry, async_add_entities, make)


class WatchSelect(KestrelEntity, SelectEntity):
    entity_description: WatchSelectDescription

    @property
    def current_option(self) -> str:
        d = self.entity_description
        return str(settings_of(self.watch)[d.group][d.field])

    async def async_select_option(self, option: str) -> None:
        d = self.entity_description
        await self.async_update_settings({d.group: {d.field: option}})


class AwayPersonSelect(KestrelEntity, SelectEntity):
    """Whose presence away mode follows: "none" or a person entity id."""

    @property
    def options(self) -> list[str]:
        people = sorted(s.entity_id for s in self.hass.states.async_all("person"))
        current = settings_of(self.watch)["away"]["person"]
        if current and current not in people:
            people.append(current)  # removed since, but still the setting
        return [NOBODY, *people]

    @property
    def current_option(self) -> str:
        return settings_of(self.watch)["away"]["person"] or NOBODY

    async def async_select_option(self, option: str) -> None:
        person = None if option == NOBODY else option
        await self.async_update_settings({"away": {"person": person}})
