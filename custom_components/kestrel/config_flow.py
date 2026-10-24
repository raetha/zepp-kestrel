"""Config flow: one Kestrel entry. Watches pair from the watch afterwards.

The options flow (Configure) manages what each paired watch keeps in sync:
painted devices (remove a bad paint, point a paint at another entity), room
calibrations, and settings (gesture trigger, away mode, room source). The
watch picks the changes up on its next Sync.
"""

from __future__ import annotations

from typing import Any, cast

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import DOMAIN, NAME, SUPPORTED_DOMAINS
from .watchdata import DWELL_SECONDS, GESTURE_KINDS, ROOM_SOURCES, clean_thresholds, settings_of, thresholds
from .watches import Watches

PAINT_ACTIONS = ("remove_last", "remove_all", "reassign")


class KestrelConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add Kestrel. Paired watches show up as devices; delete a device to unpair it."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Confirm adding the integration."""
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> KestrelOptionsFlow:
        """Manage paired watches."""
        return KestrelOptionsFlow()


def _schema(fields: dict[Any, Any]) -> Any:
    """A form schema. Typed loosely: Home Assistant 2026.10+ types forms with probatio, which
    voluptuous is an alias of there; older versions use voluptuous itself."""
    return vol.Schema(fields)


def _select(options: list[tuple[str, str]], translation_key: str | None = None) -> SelectSelector:
    config = SelectSelectorConfig(
        options=[SelectOptionDict(value=v, label=label) for v, label in options],
        mode=SelectSelectorMode.DROPDOWN,
    )
    if translation_key:
        config["translation_key"] = translation_key
    return SelectSelector(config)


class KestrelOptionsFlow(OptionsFlow):
    """Paints, rooms and settings of each paired watch."""

    def __init__(self) -> None:
        self.watch_id: str | None = None
        self.paint: str | None = None

    @property
    def _watches(self) -> Watches:
        return cast(Watches, self.config_entry.runtime_data)

    def _done(self) -> ConfigFlowResult:
        # Everything lives in the watches' storage; the entry's options stay as they are.
        return self.async_create_entry(data=dict(self.config_entry.options))

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Pick a watch (skipped when there's only one)."""
        watches = self._watches.watches
        if not watches:
            return self.async_abort(reason="no_watches")
        if len(watches) == 1:
            self.watch_id = next(iter(watches))
            return await self.async_step_watch()
        if user_input is not None:
            self.watch_id = user_input["watch"]
            return await self.async_step_watch()
        options = [(wid, w["name"]) for wid, w in watches.items()]
        return self.async_show_form(step_id="init", data_schema=_schema({vol.Required("watch"): _select(options)}))

    async def async_step_watch(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """What to manage for this watch."""
        assert self.watch_id is not None
        return self.async_show_menu(
            step_id="watch",
            menu_options=["paints", "settings", "rooms"],
            description_placeholders={"watch": self._watches.watches[self.watch_id]["name"]},
        )

    # ------------------------------------------------------------ paints
    async def async_step_paints(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Remove a bad paint, or point a paint at another entity."""
        assert self.watch_id is not None
        paints = self._watches.paints(self.watch_id)
        if not paints:
            return self.async_abort(reason="no_paints")
        if user_input is not None:
            self.paint = user_input["device"]
            action = user_input["action"]
            if action == "reassign":
                return await self.async_step_reassign()
            await self._watches.async_remove_paint(self.watch_id, self.paint, last_only=action == "remove_last")
            return self._done()

        def label(entity_id: str) -> str:
            state = self.hass.states.get(entity_id)
            name = state.name if state else entity_id
            n = len(paints[entity_id])
            return f"{name} ({n} spot{'s' if n != 1 else ''})"

        schema = _schema(
            {
                vol.Required("device"): _select([(e, label(e)) for e in sorted(paints, key=label)]),
                vol.Required("action", default="remove_last"): _select(
                    [(a, a) for a in PAINT_ACTIONS], translation_key="paint_action"
                ),
            }
        )
        return self.async_show_form(step_id="paints", data_schema=schema)

    async def async_step_reassign(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """The entity the paint should trigger instead."""
        assert self.watch_id is not None and self.paint is not None
        if user_input is not None:
            await self._watches.async_reassign_paint(self.watch_id, self.paint, user_input["entity"])
            return self._done()
        schema = _schema({vol.Required("entity"): EntitySelector(EntitySelectorConfig(domain=list(SUPPORTED_DOMAINS)))})
        return self.async_show_form(step_id="reassign", data_schema=schema, description_placeholders={"device": self.paint})

    # ------------------------------------------------------------ rooms
    async def async_step_rooms(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Delete a room calibration (calibrate again on the watch)."""
        assert self.watch_id is not None
        rooms = self._watches.synced(self.watch_id)["rooms"]
        if not rooms:
            return self.async_abort(reason="no_rooms")
        if user_input is not None:
            await self._watches.async_remove_room(self.watch_id, user_input["room"])
            return self._done()
        options = [(area_id, f"{r['name']} ({len(r['fingerprint'])} devices heard)") for area_id, r in rooms.items()]
        return self.async_show_form(step_id="rooms", data_schema=_schema({vol.Required("room"): _select(options)}))

    # ------------------------------------------------------------ settings
    async def async_step_settings(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Gesture trigger, instant toggle, away mode and room source."""
        assert self.watch_id is not None
        current = settings_of(self._watches.watches[self.watch_id])
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input["away_block"] and not user_input.get("away_person"):
                errors["away_person"] = "person_needed"
            if user_input["room_source"] == "sensor" and not user_input.get("room_sensor"):
                errors["room_sensor"] = "sensor_needed"
            if not errors:
                # the thresholds shown belong to the gesture chosen when the form opened
                cals = dict(current["gesture"]["calibrations"])
                edited = clean_thresholds(
                    {"gyro": user_input.get("gesture_gyro"), "jolt": user_input.get("gesture_jolt")}
                )
                if edited:
                    cals[current["gesture"]["kind"]] = edited
                else:
                    cals.pop(current["gesture"]["kind"], None)
                settings = {
                    "gesture": {
                        "enabled": user_input["gesture_enabled"],
                        "kind": user_input["gesture_kind"],
                        "calibrations": cals,
                    },
                    "away": {
                        "block": user_input["away_block"],
                        "person": user_input.get("away_person"),
                        "allowed": user_input.get("away_allowed") or [],
                    },
                    "room": {"source": user_input["room_source"], "sensor": user_input.get("room_sensor")},
                    "dwell": {"enabled": user_input["dwell_enabled"], "seconds": float(user_input["dwell_seconds"])},
                }
                await self._watches.async_save_settings(self.watch_id, settings)
                return self._done()

        g, away, room, dwell = current["gesture"], current["away"], current["room"], current["dwell"]
        th = thresholds(g) or {"gyro": None, "jolt": None}
        number = NumberSelector(NumberSelectorConfig(min=1, max=5000, step=1, mode=NumberSelectorMode.BOX))
        fields: dict[Any, Any] = {
            vol.Required("gesture_enabled", default=g["enabled"]): BooleanSelector(),
            vol.Required("gesture_kind", default=g["kind"]): _select([(k, k) for k in GESTURE_KINDS], "gesture_kind"),
            vol.Optional("gesture_gyro", description={"suggested_value": th["gyro"]}): number,
            vol.Optional("gesture_jolt", description={"suggested_value": th["jolt"]}): number,
            vol.Required("dwell_enabled", default=dwell["enabled"]): BooleanSelector(),
            vol.Required("dwell_seconds", default=dwell["seconds"]): NumberSelector(
                NumberSelectorConfig(
                    min=DWELL_SECONDS[0], max=DWELL_SECONDS[1], step=0.5, unit_of_measurement="s", mode=NumberSelectorMode.SLIDER
                )
            ),
            vol.Required("away_block", default=away["block"]): BooleanSelector(),
            vol.Optional("away_person", description={"suggested_value": away["person"]}): EntitySelector(
                EntitySelectorConfig(domain="person")
            ),
            vol.Optional("away_allowed", description={"suggested_value": away["allowed"]}): EntitySelector(
                EntitySelectorConfig(domain=list(SUPPORTED_DOMAINS), multiple=True)
            ),
            vol.Required("room_source", default=room["source"]): _select([(s, s) for s in ROOM_SOURCES], "room_source"),
            vol.Optional("room_sensor", description={"suggested_value": room["sensor"]}): EntitySelector(
                EntitySelectorConfig(domain="sensor")
            ),
        }
        return self.async_show_form(
            step_id="settings",
            data_schema=_schema(fields),
            errors=errors,
            description_placeholders={"kind": g["kind"]},
        )
