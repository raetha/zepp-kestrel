"""Select for each paired watch: which gesture triggers (flick, snap or tap).

Each gesture keeps its own calibration (watchdata.py), so switching is instant;
a snap or tap that was never calibrated asks for calibration on the watch.
The watch picks up a change on its next sync.
"""

from __future__ import annotations

from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import KestrelEntity, add_per_watch
from .watchdata import GESTURE_KINDS, settings_of
from .watches import Watches

PARALLEL_UPDATES = 0

GESTURE = SelectEntityDescription(
    key="gesture_kind",
    translation_key="gesture",
    entity_category=EntityCategory.CONFIG,
    options=list(GESTURE_KINDS),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(hass, entry, async_add_entities, lambda watches, wid: [GestureSelect(watches, wid, GESTURE)])


class GestureSelect(KestrelEntity, SelectEntity):
    @property
    def current_option(self) -> str:
        return settings_of(self.watch)["gesture"]["kind"]

    async def async_select_option(self, option: str) -> None:
        settings = settings_of(self.watch)
        settings["gesture"]["kind"] = option
        await self.watches.async_save_settings(self.watch_id, settings)  # updates the entity
