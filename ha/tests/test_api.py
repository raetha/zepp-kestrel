"""The watch API: info, pairing, targets and firing actions."""

from http import HTTPStatus

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events, async_mock_service

from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er, label_registry as lr

from custom_components.kestrel.const import DOMAIN, EVENT_FIRED, TOKEN_HEADER


def _watches(hass):
    return hass.config_entries.async_loaded_entries(DOMAIN)[0].runtime_data


async def _pair(hass, client, name="Balance 3"):
    res = await client.post("/api/kestrel/pair", json={"watch_name": name})
    assert res.status == HTTPStatus.OK
    pairing_id = (await res.json())["pairing_id"]
    code = _watches(hass).pairings[pairing_id].code
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    assert res.status == HTTPStatus.OK
    return await res.json()


async def test_info_without_setup_is_404(hass, hass_client_no_auth):
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "http", {})
    client = await hass_client_no_auth()
    res = await client.get("/api/kestrel/info")
    assert res.status == HTTPStatus.NOT_FOUND


async def test_info(hass, setup_entry, hass_client_no_auth):
    hass.config.location_name = "Home"
    client = await hass_client_no_auth()
    res = await client.get("/api/kestrel/info")
    assert res.status == HTTPStatus.OK
    body = await res.json()
    assert body["name"] == "Kestrel"
    assert body["ha_name"] == "Home"
    assert body["version"] == "0.1.0"


async def test_pairing_shows_a_code_and_issues_a_token(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    res = await client.post("/api/kestrel/pair", json={"watch_name": "Balance 3"})
    pairing_id = (await res.json())["pairing_id"]
    pairing = _watches(hass).pairings[pairing_id]
    # the code is shown to the HA user as a notification
    from homeassistant.components import persistent_notification

    shown = persistent_notification._async_get_or_create_notifications(hass)  # noqa: SLF001
    assert any(pairing.code in n["message"] for n in shown.values())

    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": "000000x"})
    assert res.status == HTTPStatus.FORBIDDEN
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": pairing.code})
    assert res.status == HTTPStatus.OK
    body = await res.json()
    assert body["token"] and body["watch_id"]
    assert set(body["urls"]) == {"internal"}
    # the code works once, and the notification is gone
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": pairing.code})
    assert res.status == HTTPStatus.GONE
    assert not any(pairing.code in n["message"] for n in shown.values())


async def test_too_many_wrong_codes_cancels_the_pairing(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    res = await client.post("/api/kestrel/pair", json={"watch_name": "W"})
    pairing_id = (await res.json())["pairing_id"]
    code = _watches(hass).pairings[pairing_id].code
    for _ in range(5):
        await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": "x"})
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    assert res.status == HTTPStatus.GONE


async def test_pairing_requests_are_rate_limited(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    statuses = [(await client.post("/api/kestrel/pair", json={})).status for _ in range(6)]
    assert statuses == [HTTPStatus.OK] * 5 + [HTTPStatus.TOO_MANY_REQUESTS]  # five waiting at most

    # and each address only so often, even once the waiting ones are gone
    watches = setup_entry.runtime_data
    allowed = []
    for _ in range(11):
        watches.pairings.clear()
        allowed.append(watches.allow_start("10.0.0.1"))
    assert allowed == [True] * 10 + [False]


async def test_targets_need_a_watch_token(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    res = await client.get("/api/kestrel/targets", headers={TOKEN_HEADER: "nope"})
    assert res.status == HTTPStatus.UNAUTHORIZED


async def test_targets_list_supported_entities_by_area(hass, setup_entry, hass_client_no_auth):
    area = ar.async_get(hass).async_create("Living room")
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get_or_create("light", "test", "lamp", suggested_object_id="lamp")
    ent_reg.async_update_entity(entry.entity_id, area_id=area.id)
    hass.states.async_set("light.lamp", "off", {"friendly_name": "Lamp", "supported_color_modes": ["brightness"]})
    hass.states.async_set("switch.fan", "off", {"friendly_name": "Fan plug"})
    hass.states.async_set("sensor.temp", "21")
    hass.states.async_set("lock.door", "locked", {"friendly_name": "Door"})
    restart = ent_reg.async_get_or_create(
        "button", "test", "restart", suggested_object_id="restart", entity_category=er.EntityCategory.CONFIG
    )
    hass.states.async_set(restart.entity_id, "unknown")

    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.get("/api/kestrel/targets", headers={TOKEN_HEADER: paired["token"]})
    targets = (await res.json())["targets"]
    by_id = {t["id"]: t for t in targets}
    assert set(by_id) == {"light.lamp", "switch.fan", "lock.door"}  # no configuration entities
    assert by_id["light.lamp"] == {
        "id": "light.lamp", "name": "Lamp", "domain": "light", "area": "Living room", "area_id": area.id,
        "dimmable": True, "confirm": False,
    }
    assert by_id["switch.fan"]["area_id"] is None
    assert by_id["lock.door"]["confirm"] is True
    assert targets[0]["id"] == "light.lamp"  # areas first, unassigned last


async def test_fire_toggles_fires_an_event_and_drops_retries(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "off")
    calls = async_mock_service(hass, "light", "toggle")
    events = async_capture_events(hass, EVENT_FIRED)
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    headers = {TOKEN_HEADER: paired["token"]}

    res = await client.post("/api/kestrel/fire", headers=headers, json={"target": "light.lamp", "seq": 1})
    assert (await res.json())["ok"] is True
    res = await client.post("/api/kestrel/fire", headers=headers, json={"target": "light.lamp", "seq": 1})
    assert (await res.json())["duplicate"] is True
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["entity_id"] == ["light.lamp"]
    assert len(events) == 1
    assert events[0].data["target"] == "light.lamp" and events[0].data["via"] is None and events[0].data["area_id"] is None
    assert events[0].data["watch_name"] == "Balance 3"
    assert events[0].data["target"] == "light.lamp"


async def test_dim_steps_brightness(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "on")
    calls = async_mock_service(hass, "light", "turn_on")
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    await client.post(
        "/api/kestrel/fire",
        headers={TOKEN_HEADER: paired["token"]},
        json={"target": "light.lamp", "action": "dim", "value": -20, "seq": 9},
    )
    assert calls[0].data["brightness_step_pct"] == -20


async def test_locks_need_confirmation(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("lock.door", "locked")
    calls = async_mock_service(hass, "lock", "unlock")
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    headers = {TOKEN_HEADER: paired["token"]}
    res = await client.post("/api/kestrel/fire", headers=headers, json={"target": "lock.door", "seq": 1})
    assert await res.json() == {"ok": False, "needsConfirm": True}
    res = await client.post(
        "/api/kestrel/fire", headers=headers, json={"target": "lock.door", "seq": 2, "confirmed": True}
    )
    assert (await res.json())["ok"] is True
    assert len(calls) == 1


async def test_unknown_target(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.post(
        "/api/kestrel/fire", headers={TOKEN_HEADER: paired["token"]}, json={"target": "sensor.temp"}
    )
    assert res.status == HTTPStatus.NOT_FOUND


async def test_paired_watches_survive_a_reload(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "off")
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    res = await client.get("/api/kestrel/targets", headers={TOKEN_HEADER: paired["token"]})
    assert res.status == HTTPStatus.OK


async def test_probe_results_become_events(hass, setup_entry, hass_client_no_auth):
    from custom_components.kestrel.const import EVENT_PROBE

    events = async_capture_events(hass, EVENT_PROBE)
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.post(
        "/api/kestrel/probe", headers={TOKEN_HEADER: paired["token"]}, json={"test": "rates", "results": [1]}
    )
    assert (await res.json())["ok"] is True
    await hass.async_block_till_done()
    assert events[0].data["test"] == "rates"
    assert events[0].data["watch_name"] == "Balance 3"



async def test_pairing_only_from_the_home_network(hass, setup_entry, hass_client_no_auth):
    from unittest.mock import patch

    client = await hass_client_no_auth()
    with patch("custom_components.kestrel.http.is_cloud_connection", return_value=True):
        res = await client.post("/api/kestrel/pair", json={"watch_name": "x"})
        assert res.status == HTTPStatus.FORBIDDEN
        res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": "x", "code": "1"})
        assert res.status == HTTPStatus.FORBIDDEN


def test_from_home_needs_a_local_address(hass):
    from types import SimpleNamespace

    from custom_components.kestrel.http import _from_home

    assert _from_home(hass, SimpleNamespace(remote="192.168.1.20"))
    assert _from_home(hass, SimpleNamespace(remote="127.0.0.1"))
    assert not _from_home(hass, SimpleNamespace(remote="8.8.8.8"))
    assert not _from_home(hass, SimpleNamespace(remote=None))


async def test_pairing_names_are_plain_and_pending_pairings_are_capped(hass, setup_entry):
    watches = setup_entry.runtime_data
    pairing = watches.start_pairing("[evil](http://x) **Bal*ance 3")
    assert pairing.watch_name == "evil(httpx) Balance 3"
    for i in range(4):
        assert watches.allow_start(f"10.0.0.{i}")
        watches.start_pairing("Watch")
    assert not watches.allow_start("10.0.0.99")  # five waiting already


async def test_fire_only_targets_the_watch_is_offered(hass, setup_entry, hass_client_no_auth):
    ent_reg = er.async_get(hass)
    hidden = ent_reg.async_get_or_create("lock", "test", "back", suggested_object_id="back")
    ent_reg.async_update_entity(hidden.entity_id, hidden_by=er.RegistryEntryHider.USER)
    hass.states.async_set(hidden.entity_id, "locked")  # hidden: not offered
    async_mock_service(hass, "lock", "unlock")
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.post(
        "/api/kestrel/fire", headers={TOKEN_HEADER: paired["token"]}, json={"target": hidden.entity_id, "confirmed": True}
    )
    assert res.status == HTTPStatus.NOT_FOUND


async def test_probe_results_have_a_size_limit(hass, setup_entry, hass_client_no_auth):
    from custom_components.kestrel.const import PROBE_MAX_BYTES

    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    big = {"test": "x", "data": "a" * PROBE_MAX_BYTES}
    res = await client.post("/api/kestrel/probe", headers={TOKEN_HEADER: paired["token"]}, json=big)
    assert res.status == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


async def test_is_offered_matches_the_target_list(hass, setup_entry):
    from custom_components.kestrel.targets import Offered, is_offered, list_targets

    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)
    hass.states.async_set("light.a", "off")
    hass.states.async_set("sensor.temp", "1")
    restart = ent_reg.async_get_or_create("button", "t", "r", suggested_object_id="r", entity_category=er.EntityCategory.CONFIG)
    hass.states.async_set(restart.entity_id, "unknown")
    entry = MockConfigEntry(domain="test")
    entry.add_to_hass(hass)
    device = dev_reg.async_get_or_create(config_entry_id=entry.entry_id, identifiers={("test", "d")})
    lamp = ent_reg.async_get_or_create("light", "t", "b", suggested_object_id="b", device_id=device.id)
    hass.states.async_set(lamp.entity_id, "off")
    ent_reg.async_update_entity(restart.entity_id, device_id=device.id)

    for offered in (Offered(), Offered(devices=[device.id]), Offered(entities=["light.a"]), Offered([device.id], ["light.a"])):
        listed = {t["id"] for t in list_targets(hass, limit=None, offered=offered)}
        for entity_id in hass.states.async_entity_ids():
            assert is_offered(hass, entity_id, offered) == (entity_id in listed), (entity_id, offered.devices, offered.entities)
        assert not is_offered(hass, "light.missing", offered)
    assert {t["id"] for t in list_targets(hass, limit=None, offered=Offered(devices=[device.id]))} == {lamp.entity_id}
