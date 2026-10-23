"""Config flow: one WristWand entry. Watches pair from the watch afterwards."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, NAME


class WristWandConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add WristWand. Paired watches show up as devices; delete a device to unpair it."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Confirm adding the integration."""
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")
