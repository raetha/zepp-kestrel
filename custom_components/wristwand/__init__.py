"""WristWand: point an Amazfit / Zepp OS watch at a device and trigger it.

The integration gives watches a small API of their own (see http.py): pairing
with a code shown in Home Assistant, the list of things they can point at, and
running an action. Every action fires a `wristwand_fired` event for automations.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .http import VIEWS
from .watches import Watches

_VIEWS_REGISTERED = f"{DOMAIN}_views_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load paired watches and expose the watch API."""
    watches = Watches(hass)
    await watches.async_load()
    hass.data[DOMAIN] = watches
    integration = await async_get_integration(hass, DOMAIN)
    hass.data[f"{DOMAIN}_version"] = str(integration.version or "")
    # HTTP views can't be unregistered: register once per run; they answer 404
    # while no entry is loaded (hass.data[DOMAIN] missing).
    if not hass.data.get(_VIEWS_REGISTERED):
        for view in VIEWS:
            hass.http.register_view(view())
        hass.data[_VIEWS_REGISTERED] = True
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.pop(DOMAIN, None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Removing the integration forgets every paired watch."""
    watches = Watches(hass)
    await watches.async_clear()
