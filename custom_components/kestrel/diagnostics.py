"""Diagnostics: paired watches, pairings in progress, and recent probe results, so a
tester can download one file instead of copying kestrel_probe events. Per watch from
its device page, or all at once.

Made to be attached to a public issue: token hashes and network addresses are
removed, and Bluetooth addresses (the watch hears neighbours' devices when it
calibrates rooms) are replaced by pseudonyms that stay consistent within one
download, so room matching can still be replayed (tools/replay.mjs) but the
addresses can't be read back. Pseudonyms change with every download."""

from __future__ import annotations

import hashlib
import re
import secrets
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from . import KestrelConfigEntry
from .const import DOMAIN
from .targets import list_targets

TO_REDACT = {"token_hash", "address", "url", "urls"}
MAC = re.compile(r"\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b")


def _pseudonymise(data: Any, salt: str) -> Any:
    """Every Bluetooth address, in keys and values, replaced by a salted hash."""

    def one(text: str) -> str:
        return MAC.sub(lambda m: "mac-" + hashlib.sha256((salt + m.group(0).upper()).encode()).hexdigest()[:10], text)

    if isinstance(data, dict):
        return {one(k) if isinstance(k, str) else k: _pseudonymise(v, salt) for k, v in data.items()}
    if isinstance(data, list):
        return [_pseudonymise(v, salt) for v in data]
    if isinstance(data, str):
        return one(data)
    return data


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = _pseudonymise(async_redact_data(data, TO_REDACT), secrets.token_hex(16))
    return cleaned


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: KestrelConfigEntry) -> dict[str, Any]:
    """Return diagnostics for the Kestrel entry."""
    watches = entry.runtime_data
    return _clean({
        "version": watches.version,
        "watches": list(watches.watches.values()),
        "pairings_in_progress": len(watches.pairings),
        # removed watches' setups, kept 30 days for the next pairing: what, not the data
        "removed_setups": [
            {"name": r["name"], "removed_at": r.get("removed_at"), "paints": len(r.get("paints", {})), "rooms": len(r.get("rooms", {}))}
            for r in watches.removed.values()
        ],
        "targets": len(list_targets(hass, limit=None, offered=watches.offered)),
        "offered": {"devices": sorted(watches.offered.devices), "entities": sorted(watches.offered.entities)},
        "probes": watches.probes_for(),
    })


async def async_get_device_diagnostics(
    hass: HomeAssistant, entry: KestrelConfigEntry, device: dr.DeviceEntry
) -> dict[str, Any]:
    """Return diagnostics for one paired watch."""
    watches = entry.runtime_data
    watch_id = next((ident for domain, ident in device.identifiers if domain == DOMAIN), None)
    watch = watches.watches.get(watch_id) if watch_id else None
    return _clean({
        "version": watches.version,
        "watch": watch,
        "probes": watches.probes_for(watch_id) if watch_id else [],
    })
