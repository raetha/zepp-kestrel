"""Diagnostics: paired watches (tokens redacted) and pairings in progress."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

from . import WristWandConfigEntry
from .targets import list_targets

TO_REDACT = {"token_hash"}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: WristWandConfigEntry) -> dict[str, Any]:
    """Return diagnostics for the WristWand entry."""
    watches = entry.runtime_data
    return {
        "version": watches.version,
        "watches": async_redact_data(list(watches.watches.values()), TO_REDACT),
        "pairings_in_progress": len(watches.pairings),
        "targets": len(list_targets(hass)),
    }
