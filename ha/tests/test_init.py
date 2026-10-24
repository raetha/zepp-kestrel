"""Setup, devices, unload and removal."""

from http import HTTPStatus

from homeassistant.helpers import device_registry as dr

from custom_components.kestrel.const import DOMAIN, TOKEN_HEADER
from custom_components.kestrel.diagnostics import async_get_config_entry_diagnostics
from custom_components.kestrel.watches import Watches


async def _paired(entry, name="Balance 3"):
    watches = entry.runtime_data
    pairing = watches.start_pairing(name)
    status, watch, token = await watches.async_confirm(pairing.pairing_id, pairing.code)
    assert status == "ok"
    return watch, token


async def test_each_paired_watch_is_a_device(hass, setup_entry):
    watch, _ = await _paired(setup_entry)
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, watch["id"]), setup_entry.entry_id)
    assert device is not None
    assert device.name == "Balance 3"
    assert device.config_entry_id == setup_entry.entry_id


async def test_deleting_the_device_unpairs_the_watch(hass, setup_entry, hass_client_no_auth):
    from custom_components.kestrel import async_remove_config_entry_device

    hass.states.async_set("light.lamp", "off")
    watch, token = await _paired(setup_entry)
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, watch["id"]), setup_entry.entry_id)
    assert await async_remove_config_entry_device(hass, setup_entry, device)
    client = await hass_client_no_auth()
    res = await client.get("/api/kestrel/targets", headers={TOKEN_HEADER: token})
    assert res.status == HTTPStatus.UNAUTHORIZED


async def test_stale_devices_are_removed_on_setup(hass, setup_entry):
    watch, _ = await _paired(setup_entry)
    dev_reg = dr.async_get(hass)
    dev_reg.async_get_or_create(
        config_entry_id=setup_entry.entry_id, identifiers={(DOMAIN, "gone")}, name="Old watch"
    )
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert dev_reg.async_get_device_by_identifier((DOMAIN, "gone"), setup_entry.entry_id) is None
    assert dev_reg.async_get_device_by_identifier((DOMAIN, watch["id"]), setup_entry.entry_id) is not None


async def test_unloaded_entry_answers_404(hass, setup_entry, hass_client_no_auth):
    assert await hass.config_entries.async_unload(setup_entry.entry_id)
    client = await hass_client_no_auth()
    for method, path in (("get", "/api/kestrel/info"), ("post", "/api/kestrel/pair"),
                         ("post", "/api/kestrel/pair/confirm"), ("get", "/api/kestrel/targets")):
        res = await getattr(client, method)(path)
        assert res.status == HTTPStatus.NOT_FOUND, path


async def test_removing_the_entry_forgets_watches(hass, setup_entry):
    await _paired(setup_entry)
    await hass.config_entries.async_remove(setup_entry.entry_id)
    await hass.async_block_till_done()
    fresh = Watches(hass, "x")
    await fresh.async_load()
    assert fresh.watches == {}


async def test_diagnostics_redact_tokens(hass, setup_entry):
    hass.states.async_set("light.lamp", "off")
    watch, _ = await _paired(setup_entry)
    diag = await async_get_config_entry_diagnostics(hass, setup_entry)
    assert diag["watches"][0]["name"] == "Balance 3"
    assert diag["watches"][0]["token_hash"] == "**REDACTED**"
    assert diag["targets"] == 1
    assert diag["version"] == "0.1.0"
    assert diag["watches"][0]["id"] == watch["id"]


async def test_pairings_expire(hass, setup_entry):
    watches = setup_entry.runtime_data
    pairing = watches.start_pairing("W", now=0)
    status, _, _ = await watches.async_confirm(pairing.pairing_id, pairing.code, now=10_000)
    assert status == "gone"


async def test_probe_results_are_kept_for_diagnostics(hass, setup_entry, hass_client_no_auth, hass_storage):
    from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE

    from custom_components.kestrel.const import DOMAIN, PROBES_KEPT, TOKEN_HEADER
    from custom_components.kestrel.diagnostics import async_get_device_diagnostics

    watches = setup_entry.runtime_data
    one, token_one = await _paired(setup_entry)
    two, _ = await _paired(setup_entry)
    client = await hass_client_no_auth()
    # a body can't pose as another watch
    res = await client.post(
        "/api/kestrel/probe",
        headers={TOKEN_HEADER: token_one},
        json={"test": "tilt", "watch_id": two["id"], "raw": {"rows": [[1, 2]]}},
    )
    assert res.status == 200
    watches.add_probe(two, {"test": "latency"})

    diag = await async_get_config_entry_diagnostics(hass, setup_entry)
    assert [p["test"] for p in diag["probes"]] == ["tilt", "latency"]
    assert diag["probes"][0]["watch_id"] == one["id"]
    assert diag["probes"][0]["raw"] == {"rows": [[1, 2]]}
    assert "received" in diag["probes"][0]

    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, one["id"]), setup_entry.entry_id)
    per_watch = await async_get_device_diagnostics(hass, setup_entry, device)
    assert per_watch["watch"]["token_hash"] == "**REDACTED**"
    assert [p["test"] for p in per_watch["probes"]] == ["tilt"]

    # saved (after a short delay, or when Home Assistant stops) and loaded again after a restart
    assert "kestrel.probes" not in hass_storage
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()
    fresh = Watches(hass, setup_entry.entry_id)
    await fresh.async_load()
    assert [p["test"] for p in fresh.probes_for()] == ["tilt", "latency"]

    # only the newest are kept
    for i in range(PROBES_KEPT + 5):
        watches.add_probe(two, {"test": "rates", "i": i})
    assert len(watches.probes_for()) == PROBES_KEPT
    assert watches.probes_for()[-1]["i"] == PROBES_KEPT + 4

    # unpairing a watch drops its results
    await watches.async_remove([two["id"]])
    assert watches.probes_for() == []
    other = dr.async_get(hass).async_get_or_create(config_entry_id=setup_entry.entry_id, identifiers={("other", "x")})
    assert (await async_get_device_diagnostics(hass, setup_entry, other))["probes"] == []


async def test_no_external_url_is_a_repair_issue_once_a_watch_pairs(hass, setup_entry):
    from homeassistant.core_config import async_process_ha_core_config
    from homeassistant.helpers import issue_registry as ir

    from custom_components.kestrel.const import DOMAIN

    reg = ir.async_get(hass)
    assert reg.async_get_issue(DOMAIN, "no_external_url") is None  # nothing paired yet
    watches = setup_entry.runtime_data
    pairing = watches.start_pairing("Balance 3")
    await watches.async_confirm(pairing.pairing_id, pairing.code)
    assert reg.async_get_issue(DOMAIN, "no_external_url") is not None

    await async_process_ha_core_config(hass, {"external_url": "https://ha.example.com"})
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    assert reg.async_get_issue(DOMAIN, "no_external_url") is None


async def test_settings_on_an_unpaired_watch_raise(hass, setup_entry):
    import pytest

    from homeassistant.exceptions import HomeAssistantError
    from homeassistant.helpers import entity_registry as er

    from custom_components.kestrel.const import DOMAIN

    watches = setup_entry.runtime_data
    pairing = watches.start_pairing("Balance 3")
    _, watch, _ = await watches.async_confirm(pairing.pairing_id, pairing.code)
    await hass.async_block_till_done()
    switch = er.async_get(hass).async_get_entity_id("switch", DOMAIN, f"{watch['id']}_instant_toggle")
    watches.watches.pop(watch["id"])  # unpaired behind the entity's back
    entity = hass.data["entity_components"]["switch"].get_entity(switch)
    with pytest.raises(HomeAssistantError) as err:  # Home Assistant skips unavailable entities; a race still lands here
        await entity.async_turn_on()
    assert err.value.translation_key == "watch_unpaired"
