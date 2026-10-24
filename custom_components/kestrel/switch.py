"""Switches for each paired watch: the gesture trigger and instant toggle.

Both are the watch's settings (watchdata.py), also editable in Configure.
The watch picks up a change on its next sync.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import KestrelEntity, add_per_watch
from .watchdata import settings_of
from .watches import Watches

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class WatchSwitchDescription(SwitchEntityDescription):
    """A boolean setting: settings[group][field]."""

    group: str
    field: str


SWITCHES: tuple[WatchSwitchDescription, ...] = (
    WatchSwitchDescription(
        key="gesture", translation_key="gesture", entity_category=EntityCategory.CONFIG, group="gesture", field="enabled"
    ),
    WatchSwitchDescription(
        key="instant_toggle",
        translation_key="instant_toggle",
        entity_category=EntityCategory.CONFIG,
        group="dwell",
        field="enabled",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(
        hass, entry, async_add_entities, lambda watches, wid: [WatchSwitch(watches, wid, d) for d in SWITCHES]
    )


class WatchSwitch(KestrelEntity, SwitchEntity):
    entity_description: WatchSwitchDescription

    @property
    def is_on(self) -> bool:
        d = self.entity_description
        return bool(settings_of(self.watch)[d.group][d.field])

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._async_set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._async_set(False)

    async def _async_set(self, on: bool) -> None:
        d = self.entity_description
        await self.async_update_settings({d.group: {d.field: on}})
