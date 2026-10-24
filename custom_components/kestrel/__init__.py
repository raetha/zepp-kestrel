"""Kestrel: point an Amazfit / Zepp OS watch at a device and trigger it.

The integration gives watches a small API of their own (see http.py): pairing
with a code shown in Home Assistant, the list of things they can point at, and
running an action. Each paired watch is a device; deleting the device unpairs
it. Every action fires a `kestrel_fired` event for automations. Each watch's
device has sensors (last triggered, room, last seen...) and switches (gesture
trigger, instant toggle).
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .http import VIEWS
from .targets import Offered
from .watches import Watches

type KestrelConfigEntry = ConfigEntry[Watches]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.IMAGE, Platform.NUMBER, Platform.SELECT, Platform.SENSOR, Platform.SWITCH]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the watch API once. It answers 404 while no entry is loaded."""
    for view in VIEWS:
        hass.http.register_view(view())
    return True


async def async_setup_entry(hass: HomeAssistant, entry: KestrelConfigEntry) -> bool:
    """Load paired watches and their devices."""
    integration = await async_get_integration(hass, DOMAIN)
    watches = Watches(hass, entry.entry_id, version=str(integration.version or ""), offered=Offered.from_options(entry.options))
    await watches.async_load()
    watches.sync_devices()
    entry.runtime_data = watches
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_changed))
    return True


async def _async_options_changed(hass: HomeAssistant, entry: KestrelConfigEntry) -> None:
    """The devices for watches changed in Configure: reload so every request uses the new choice."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: KestrelConfigEntry) -> bool:
    """Unload the entities; the API checks for a loaded entry on every request."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: KestrelConfigEntry) -> None:
    """Removing the integration forgets every paired watch."""
    await Watches(hass, entry.entry_id).async_clear()


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: KestrelConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Deleting a watch's device unpairs that watch."""
    watch_ids = [ident for domain, ident in device.identifiers if domain == DOMAIN]
    await entry.runtime_data.async_remove(watch_ids)
    return True
