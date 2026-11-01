"""Repairs: a watch that has gone quiet can be removed, and its token with it.

A paired watch keeps a working token until it's removed. One that hasn't been heard
from in QUIET_DAYS (an old watch, a duplicate from pairing again, a test install)
gets a Repairs notice; its fix removes the watch like deleting its device does (its
paints, rooms and settings are still kept REMOVED_KEPT_DAYS for a watch paired later).
The notice goes away by itself when the watch is heard from again.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol
from homeassistant import data_entry_flow
from homeassistant.components.repairs import RepairsFlow
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN, QUIET_CHECK_EVERY, QUIET_DAYS, QUIET_ISSUE


def issue_id(watch_id: str) -> str:
    return f"{QUIET_ISSUE}_{watch_id}"


@callback
def async_check_quiet(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Raise a notice for each quiet watch; drop notices for watches heard from or gone."""
    watches = entry.runtime_data
    quiet = watches.quiet()
    for watch_id, days in quiet.items():
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id(watch_id),
            is_fixable=True,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=QUIET_ISSUE,
            translation_placeholders={"watch": watches.display_name(watch_id), "days": str(days), "limit": str(QUIET_DAYS)},
            data={"entry_id": entry.entry_id, "watch_id": watch_id},
        )
    prefix = f"{QUIET_ISSUE}_"
    for (domain, iid) in list(ir.async_get(hass).issues):
        if domain == DOMAIN and iid.startswith(prefix) and iid[len(prefix):] not in quiet:
            ir.async_delete_issue(hass, DOMAIN, iid)


@callback
def async_start_quiet_checks(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Check now and every QUIET_CHECK_EVERY while the entry is loaded."""
    async_check_quiet(hass, entry)

    @callback
    def _check(_now: datetime) -> None:
        async_check_quiet(hass, entry)

    entry.async_on_unload(async_track_time_interval(hass, _check, timedelta(seconds=QUIET_CHECK_EVERY)))


@callback
def async_delete_quiet_issues(hass: HomeAssistant) -> None:
    """The integration is gone: so are its notices."""
    prefix = f"{QUIET_ISSUE}_"
    for (domain, iid) in list(ir.async_get(hass).issues):
        if domain == DOMAIN and iid.startswith(prefix):
            ir.async_delete_issue(hass, DOMAIN, iid)


class RemoveQuietWatch(RepairsFlow):
    """Confirm, then remove the watch (its token stops working)."""

    def __init__(self, entry_id: str, watch_id: str) -> None:
        self.entry_id = entry_id
        self.watch_id = watch_id

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> data_entry_flow.FlowResult:
        return await self.async_step_confirm()

    async def async_step_confirm(self, user_input: dict[str, Any] | None = None) -> data_entry_flow.FlowResult:
        entry = self.hass.config_entries.async_get_entry(self.entry_id)
        watches = entry.runtime_data if entry is not None and hasattr(entry, "runtime_data") else None
        if watches is None or self.watch_id not in watches.watches:
            return self.async_abort(reason="gone")
        if user_input is not None:
            device = dr.async_get(self.hass).async_get_device_by_identifier((DOMAIN, self.watch_id), self.entry_id)
            await watches.async_remove([self.watch_id])
            if device is not None:
                dr.async_get(self.hass).async_remove_device(device.id)
            return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="confirm",
            data_schema=vol.Schema({}),
            description_placeholders={"watch": watches.display_name(self.watch_id)},
        )


async def async_create_fix_flow(hass: HomeAssistant, issue_id: str, data: dict[str, Any] | None) -> RepairsFlow:
    data = data or {}
    return RemoveQuietWatch(str(data.get("entry_id", "")), str(data.get("watch_id", "")))
