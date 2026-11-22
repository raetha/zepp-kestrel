"""The paint map of each paired watch: an image of where its paints are (paintmap.py)."""

from __future__ import annotations

import hashlib
import json

from homeassistant.components.image import ImageEntity, ImageEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import signal_watch_updated
from .entity import KestrelEntity, add_per_watch
from .paintmap import render
from .watches import Watches

PARALLEL_UPDATES = 0

PAINT_MAP = ImageEntityDescription(key="paint_map", translation_key="paint_map", entity_category=EntityCategory.DIAGNOSTIC)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(hass, entry, async_add_entities, lambda watches, wid: [PaintMap(hass, watches, wid)])


class PaintMap(KestrelEntity, ImageEntity):
    """SVG: one compass dial per room, each painted spot where it was painted."""

    _attr_content_type = "image/svg+xml"

    def __init__(self, hass: HomeAssistant, watches: Watches, watch_id: str) -> None:
        KestrelEntity.__init__(self, watches, watch_id, PAINT_MAP)
        ImageEntity.__init__(self, hass)
        self._drawn = self._fingerprint()
        self._attr_image_last_updated = dt_util.utcnow()

    def _fingerprint(self) -> str:
        """What the picture depends on (paints, room names, device names), hashed."""
        synced = self.watches.synced(self.watch_id) if self.watch_id in self.watches.watches else {}
        paints = synced.get("paints") or {}
        names = {e: self._name(e) for e in paints}
        rooms = {k: r.get("name") for k, r in (synced.get("rooms") or {}).items()}
        blob = json.dumps([paints, rooms, names], sort_keys=True, default=str)
        return hashlib.sha256(blob.encode()).hexdigest()

    def _name(self, entity_id: str) -> str:
        state = self.hass.states.get(entity_id) if self.hass else None
        return state.name if state else entity_id

    async def async_added_to_hass(self) -> None:
        # not KestrelEntity's: the picture's time moves only when the picture changes
        self.async_on_remove(async_dispatcher_connect(self.hass, signal_watch_updated(self.watch_id), self._changed))

    @callback
    def _changed(self) -> None:
        drawn = self._fingerprint()
        if drawn != self._drawn:
            self._drawn = drawn
            self._attr_image_last_updated = dt_util.utcnow()
        self.async_write_ha_state()

    async def async_image(self) -> bytes | None:
        synced = self.watches.synced(self.watch_id) if self.watch_id in self.watches.watches else {}
        # room names from the calibrations, else from Home Assistant's areas (a room sensor tags spots too)
        rooms = {a.id: a.name for a in ar.async_get(self.hass).async_list_areas()}
        rooms.update({k: str(r.get("name") or k) for k, r in (synced.get("rooms") or {}).items()})
        return render(synced.get("paints") or {}, rooms, self._name).encode()
