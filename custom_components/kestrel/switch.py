"""Switches for each paired watch: gesture trigger, instant toggle, opening on Point, learning,
and detailed diagnostics (which turns itself off after a week).

All are the watch's settings (watchdata.py), also editable in Configure.
The watch picks up a change on its next sync.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .entity import KestrelEntity, add_per_watch
from .watchdata import settings_of
from .watches import Watches

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class WatchSwitchDescription(SwitchEntityDescription):
    """A boolean setting: settings[group][field]."""

    group: str
    field: str


SWITCHES: tuple[WatchSwitchDescription, ...] = (
    WatchSwitchDescription(
        key="gesture", translation_key="gesture", entity_category=EntityCategory.CONFIG, group="gesture", field="enabled"
    ),
    WatchSwitchDescription(
        key="instant_toggle",
        translation_key="instant_toggle",
        entity_category=EntityCategory.CONFIG,
        group="dwell",
        field="enabled",
    ),
    WatchSwitchDescription(
        key="open_on_point", translation_key="open_on_point", entity_category=EntityCategory.CONFIG, group="start", field="point"
    ),
    WatchSwitchDescription(
        key="learn", translation_key="learn", entity_category=EntityCategory.CONFIG, group="learn", field="enabled"
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry[Watches], async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    add_per_watch(
        hass,
        entry,
        async_add_entities,
        lambda watches, wid: [*(WatchSwitch(watches, wid, d) for d in SWITCHES), DetailedDiagnostics(watches, wid, DIAGNOSTICS)],
    )


class WatchSwitch(KestrelEntity, SwitchEntity):
    entity_description: WatchSwitchDescription

    @property
    def is_on(self) -> bool:
        d = self.entity_description
        return bool(settings_of(self.watch)[d.group][d.field])

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._async_set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._async_set(False)

    async def _async_set(self, on: bool) -> None:
        d = self.entity_description
        await self.async_update_settings({d.group: {d.field: on}})


DIAGNOSTICS = SwitchEntityDescription(
    key="detailed_diagnostics", translation_key="detailed_diagnostics", entity_category=EntityCategory.DIAGNOSTIC
)


class DetailedDiagnostics(KestrelEntity, SwitchEntity):
    """The watch also sends aim traces, its trail and room scans. Off again after a week by itself."""

    @property
    def is_on(self) -> bool:
        return bool(settings_of(self.watch)["diagnostics"]["detailed"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        until = settings_of(self.watch)["diagnostics"]["until"]
        return {"until": dt_util.utc_from_timestamp(until).isoformat() if self.is_on else None}

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._async_set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._async_set(False)

    async def _async_set(self, on: bool) -> None:
        if self.watch_id not in self.watches.watches:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="watch_unpaired")
        await self.watches.async_set_detailed_diagnostics(self.watch_id, on)
