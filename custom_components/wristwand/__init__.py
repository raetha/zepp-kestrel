"""WristWand: point an Amazfit / Zepp OS watch at a device and trigger it.

The integration gives watches a small API of their own (see http.py): pairing
with a code shown in Home Assistant, the list of things they can point at, and
running an action. Each paired watch is a device; deleting the device unpairs
it. Every action fires a `wristwand_fired` event for automations. Each watch's
device has sensors (last triggered, room, last seen...) and switches (gesture
trigger, away mode).
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
from .watches import Watches

type WristWandConfigEntry = ConfigEntry[Watches]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.SENSOR, Platform.SWITCH]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the watch API once. It answers 404 while no entry is loaded."""
    for view in VIEWS:
        hass.http.register_view(view())
    return True


async def async_setup_entry(hass: HomeAssistant, entry: WristWandConfigEntry) -> bool:
    """Load paired watches and their devices."""
    integration = await async_get_integration(hass, DOMAIN)
    watches = Watches(hass, entry.entry_id, version=str(integration.version or ""))
    await watches.async_load()
    watches.sync_devices()
    entry.runtime_data = watches
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: WristWandConfigEntry) -> bool:
    """Unload the entities; the API checks for a loaded entry on every request."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: WristWandConfigEntry) -> None:
    """Removing the integration forgets every paired watch."""
    await Watches(hass, entry.entry_id).async_clear()


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: WristWandConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Deleting a watch's device unpairs that watch."""
    watch_ids = [ident for domain, ident in device.identifiers if domain == DOMAIN]
    await entry.runtime_data.async_remove(watch_ids)
    return True
