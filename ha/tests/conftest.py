"""Fixtures for the Kestrel component tests."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.kestrel.const import DOMAIN

pytest_plugins = "pytest_homeassistant_custom_component"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load custom_components/ from this repository."""
    yield


@pytest.fixture
async def setup_entry(hass):
    """Kestrel set up, with the http component running."""
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "homeassistant", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Kestrel", data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry
