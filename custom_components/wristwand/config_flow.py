"""Config flow: one WristWand entry; its options remove paired watches."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, NAME


class WristWandConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add WristWand. Watches are paired from the watch afterwards."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return WristWandOptionsFlow()


class WristWandOptionsFlow(OptionsFlow):
    """Remove paired watches."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        watches = self.hass.data.get(DOMAIN)
        paired = {wid: w["name"] for wid, w in (watches.watches.items() if watches else [])}
        if not paired:
            return self.async_abort(reason="no_watches")
        if user_input is not None:
            await watches.async_remove(list(user_input.get("remove", [])))
            return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({vol.Optional("remove", default=[]): cv.multi_select(paired)}),
            description_placeholders={"count": str(len(paired))},
        )
