"""Edge cases: bad requests, failing services, each domain's action, limits."""

from http import HTTPStatus

from pytest_homeassistant_custom_component.common import async_mock_service

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from custom_components.kestrel.const import DOMAIN, PAIR_WINDOW, TOKEN_HEADER
from custom_components.kestrel.targets import service_call


async def _token(hass, entry):
    watches = entry.runtime_data
    pairing = watches.start_pairing("Balance 3")
    _, _, token = await watches.async_confirm(pairing.pairing_id, pairing.code)
    return token


async def test_bad_bodies_are_rejected(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    headers = {TOKEN_HEADER: await _token(hass, setup_entry), "Content-Type": "application/json"}
    # pairing without a body still works (default name); confirm needs JSON
    res = await client.post("/api/kestrel/pair", data="not json")
    assert res.status == HTTPStatus.OK
    res = await client.post("/api/kestrel/pair/confirm", data="not json")
    assert res.status == HTTPStatus.BAD_REQUEST
    for path in ("/api/kestrel/fire", "/api/kestrel/probe"):
        res = await client.post(path, headers=headers, data="not json")
        assert res.status == HTTPStatus.BAD_REQUEST, path
    res = await client.post("/api/kestrel/probe", headers=headers, json=[1, 2])
    assert res.status == HTTPStatus.BAD_REQUEST
    res = await client.post("/api/kestrel/fire", headers={TOKEN_HEADER: "nope"}, json={})
    assert res.status == HTTPStatus.UNAUTHORIZED
    res = await client.post("/api/kestrel/probe", headers={TOKEN_HEADER: "nope"}, json={})
    assert res.status == HTTPStatus.UNAUTHORIZED


async def test_a_failing_service_is_reported(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "off")

    async def broken(call):
        raise HomeAssistantError("Lamp unreachable")

    hass.services.async_register("light", "toggle", broken)
    client = await hass_client_no_auth()
    res = await client.post(
        "/api/kestrel/fire",
        headers={TOKEN_HEADER: await _token(hass, setup_entry)},
        json={"target": "light.lamp", "seq": 1},
    )
    assert await res.json() == {"ok": False, "error": "Lamp unreachable"}


async def test_pairing_reports_only_the_home_address(hass, setup_entry, hass_client_no_auth):
    await hass.config.async_update(internal_url="http://192.168.1.5:8123", external_url="https://abc.ui.nabu.casa")
    client = await hass_client_no_auth()
    res = await client.post("/api/kestrel/pair", json={"watch_name": "W"})
    pairing_id = (await res.json())["pairing_id"]
    code = setup_entry.runtime_data.pairings[pairing_id].code
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    assert (await res.json())["urls"] == {"internal": "http://192.168.1.5:8123"}  # never the Nabu Casa one


async def test_hidden_and_disabled_entities_are_left_out(hass, setup_entry, hass_client_no_auth):
    ent_reg = er.async_get(hass)
    hidden = ent_reg.async_get_or_create("light", "test", "hidden", suggested_object_id="hidden")
    ent_reg.async_update_entity(hidden.entity_id, hidden_by=er.RegistryEntryHider.USER)
    hass.states.async_set("light.hidden", "off")
    hass.states.async_set("light.shown", "off")
    client = await hass_client_no_auth()
    res = await client.get("/api/kestrel/targets", headers={TOKEN_HEADER: await _token(hass, setup_entry)})
    assert [t["id"] for t in (await res.json())["targets"]] == ["light.shown"]


async def test_each_domain_maps_to_its_service(hass, setup_entry):
    assert service_call(hass, "scene.movie", "toggle", None, False)[:2] == ("scene", "turn_on")
    assert service_call(hass, "script.goodnight", "toggle", None, False)[:2] == ("script", "turn_on")
    assert service_call(hass, "button.bell", "toggle", None, False)[:2] == ("button", "press")
    assert service_call(hass, "media_player.tv", "toggle", None, False)[:2] == ("media_player", "media_play_pause")
    assert service_call(hass, "switch.fan", "toggle", None, False)[:2] == ("homeassistant", "toggle")
    assert service_call(hass, "lock.door", "toggle", None, True)[:2] == ("lock", "lock")
    assert service_call(hass, "light.lamp", "dim", "bad", False)[2]["brightness_step_pct"] == 0
    assert service_call(hass, "light.lamp", "dim", 500, False)[2]["brightness_step_pct"] == 100


async def test_rate_limit_window_slides(hass, setup_entry):
    watches = setup_entry.runtime_data
    for _ in range(10):
        assert watches.allow_start("1.2.3.4", now=0)
    assert not watches.allow_start("1.2.3.4", now=1)
    assert watches.allow_start("1.2.3.4", now=PAIR_WINDOW + 1)


async def test_watch_lookup_and_sequence_edges(hass, setup_entry):
    watches = setup_entry.runtime_data
    assert watches.by_token(None) is None
    assert watches.first_time("w", None)
    assert watches.first_time("w", 5)
    assert not watches.first_time("w", 5)
    assert DOMAIN == "kestrel"


async def test_fire_without_a_seq_still_runs(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("switch.fan", "off")
    calls = async_mock_service(hass, "switch", "toggle")
    client = await hass_client_no_auth()
    res = await client.post(
        "/api/kestrel/fire", headers={TOKEN_HEADER: await _token(hass, setup_entry)}, json={"target": "switch.fan"}
    )
    assert (await res.json())["ok"] is True
    await hass.async_block_till_done()
    assert len(calls) == 1
