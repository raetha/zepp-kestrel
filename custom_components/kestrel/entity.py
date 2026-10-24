"""Base for the entities each paired watch gets (sensor.py, switch.py)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity, EntityDescription
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, SIGNAL_WATCH_ADDED, signal_watch_updated
from .watches import Watches


class KestrelEntity(Entity):
    """Something about one watch. Updated by dispatcher signals, never polled."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, watches: Watches, watch_id: str, description: EntityDescription) -> None:
        self.watches = watches
        self.watch_id = watch_id
        self.entity_description = description
        self._attr_unique_id = f"{watch_id}_{description.key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, watch_id)})

    @property
    def watch(self) -> dict[str, Any]:
        return self.watches.watches.get(self.watch_id, {})

    @property
    def available(self) -> bool:
        return self.watch_id in self.watches.watches

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, signal_watch_updated(self.watch_id), self.async_write_ha_state)
        )


def add_per_watch(
    hass: HomeAssistant,
    entry: ConfigEntry[Watches],
    async_add_entities: AddConfigEntryEntitiesCallback,
    make: Callable[[Watches, str], list[Entity]],
) -> None:
    """Entities for every paired watch now, and for each watch paired later."""
    watches = entry.runtime_data

    @callback
    def add(watch_id: str) -> None:
        async_add_entities(make(watches, watch_id))

    for watch_id in list(watches.watches):
        add(watch_id)
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_WATCH_ADDED, add))
