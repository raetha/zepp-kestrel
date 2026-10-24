"""Diagnostics: paired watches (tokens redacted), pairings in progress, and
recent probe results, so a tester can download one file instead of copying
wristwand_probe events. Per watch from its device page, or all at once."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from . import WristWandConfigEntry
from .const import DOMAIN
from .targets import list_targets

TO_REDACT = {"token_hash"}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: WristWandConfigEntry) -> dict[str, Any]:
    """Return diagnostics for the WristWand entry."""
    watches = entry.runtime_data
    return {
        "version": watches.version,
        "watches": async_redact_data(list(watches.watches.values()), TO_REDACT),
        "pairings_in_progress": len(watches.pairings),
        "targets": len(list_targets(hass, limit=None)),
        "probes": watches.probes_for(),
    }


async def async_get_device_diagnostics(
    hass: HomeAssistant, entry: WristWandConfigEntry, device: dr.DeviceEntry
) -> dict[str, Any]:
    """Return diagnostics for one paired watch."""
    watches = entry.runtime_data
    watch_id = next((ident for domain, ident in device.identifiers if domain == DOMAIN), None)
    watch = watches.watches.get(watch_id) if watch_id else None
    return {
        "version": watches.version,
        "watch": async_redact_data(watch, TO_REDACT) if watch else None,
        "probes": watches.probes_for(watch_id) if watch_id else [],
    }
