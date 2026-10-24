"""Repair issues: tell the user about setups that limit their watches."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.network import NoURLAvailableError, get_url

from .const import DOMAIN

NO_EXTERNAL_URL = "no_external_url"


def check_external_url(hass: HomeAssistant, watches_paired: bool) -> None:
    """With watches paired but no address that works away from home, say so (they only work at home)."""
    try:
        get_url(hass, allow_internal=False, prefer_cloud=True)
        missing = False
    except NoURLAvailableError:
        missing = True
    if missing and watches_paired:
        ir.async_create_issue(
            hass,
            DOMAIN,
            NO_EXTERNAL_URL,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=NO_EXTERNAL_URL,
            learn_more_url="https://www.home-assistant.io/docs/configuration/remote/",
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, NO_EXTERNAL_URL)
