"""The watch API: info, pairing, targets and firing actions."""

from http import HTTPStatus

from pytest_homeassistant_custom_component.common import async_capture_events, async_mock_service

from homeassistant.helpers import area_registry as ar, entity_registry as er, label_registry as lr

from custom_components.wristwand.const import DOMAIN, EVENT_FIRED, TOKEN_HEADER


async def _pair(hass, client, name="Balance 3"):
    res = await client.post("/api/wristwand/pair", json={"watch_name": name})
    assert res.status == HTTPStatus.OK
    pairing_id = (await res.json())["pairing_id"]
    code = hass.data[DOMAIN].pairings[pairing_id].code
    res = await client.post("/api/wristwand/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    assert res.status == HTTPStatus.OK
    return await res.json()


async def test_info_without_setup_is_404(hass, hass_client_no_auth):
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "http", {})
    client = await hass_client_no_auth()
    res = await client.get("/api/wristwand/info")
    assert res.status == HTTPStatus.NOT_FOUND


async def test_info(hass, setup_entry, hass_client_no_auth):
    hass.config.location_name = "Home"
    client = await hass_client_no_auth()
    res = await client.get("/api/wristwand/info")
    assert res.status == HTTPStatus.OK
    body = await res.json()
    assert body["name"] == "WristWand"
    assert body["ha_name"] == "Home"
    assert body["version"] == "0.1.0"


async def test_pairing_shows_a_code_and_issues_a_token(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    res = await client.post("/api/wristwand/pair", json={"watch_name": "Balance 3"})
    pairing_id = (await res.json())["pairing_id"]
    pairing = hass.data[DOMAIN].pairings[pairing_id]
    # the code is shown to the HA user as a notification
    from homeassistant.components import persistent_notification

    shown = persistent_notification._async_get_or_create_notifications(hass)  # noqa: SLF001
    assert any(pairing.code in n["message"] for n in shown.values())

    res = await client.post("/api/wristwand/pair/confirm", json={"pairing_id": pairing_id, "code": "000000x"})
    assert res.status == HTTPStatus.FORBIDDEN
    res = await client.post("/api/wristwand/pair/confirm", json={"pairing_id": pairing_id, "code": pairing.code})
    assert res.status == HTTPStatus.OK
    body = await res.json()
    assert body["token"] and body["watch_id"]
    assert set(body["urls"]) == {"internal", "external"}
    # the code works once, and the notification is gone
    res = await client.post("/api/wristwand/pair/confirm", json={"pairing_id": pairing_id, "code": pairing.code})
    assert res.status == HTTPStatus.GONE
    assert not any(pairing.code in n["message"] for n in shown.values())


async def test_too_many_wrong_codes_cancels_the_pairing(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    res = await client.post("/api/wristwand/pair", json={"watch_name": "W"})
    pairing_id = (await res.json())["pairing_id"]
    code = hass.data[DOMAIN].pairings[pairing_id].code
    for _ in range(5):
        await client.post("/api/wristwand/pair/confirm", json={"pairing_id": pairing_id, "code": "x"})
    res = await client.post("/api/wristwand/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    assert res.status == HTTPStatus.GONE


async def test_pairing_requests_are_rate_limited(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    statuses = [(await client.post("/api/wristwand/pair", json={})).status for _ in range(11)]
    assert statuses[-1] == HTTPStatus.TOO_MANY_REQUESTS
    assert statuses[:10] == [HTTPStatus.OK] * 10


async def test_targets_need_a_watch_token(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    res = await client.get("/api/wristwand/targets", headers={TOKEN_HEADER: "nope"})
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

    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.get("/api/wristwand/targets", headers={TOKEN_HEADER: paired["token"]})
    targets = (await res.json())["targets"]
    by_id = {t["id"]: t for t in targets}
    assert set(by_id) == {"light.lamp", "switch.fan", "lock.door"}
    assert by_id["light.lamp"] == {
        "id": "light.lamp", "name": "Lamp", "domain": "light", "area": "Living room", "dimmable": True, "confirm": False,
    }
    assert by_id["lock.door"]["confirm"] is True
    assert targets[0]["id"] == "light.lamp"  # areas first, unassigned last


async def test_the_wristwand_label_narrows_the_list(hass, setup_entry, hass_client_no_auth):
    label = lr.async_get(hass).async_create("WristWand")
    ent_reg = er.async_get(hass)
    entry = ent_reg.async_get_or_create("light", "test", "lamp", suggested_object_id="lamp")
    ent_reg.async_update_entity(entry.entity_id, labels={label.label_id})
    hass.states.async_set("light.lamp", "off")
    hass.states.async_set("switch.heater", "off")

    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.get("/api/wristwand/targets", headers={TOKEN_HEADER: paired["token"]})
    assert [t["id"] for t in (await res.json())["targets"]] == ["light.lamp"]


async def test_fire_toggles_fires_an_event_and_drops_retries(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "off")
    calls = async_mock_service(hass, "light", "toggle")
    events = async_capture_events(hass, EVENT_FIRED)
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    headers = {TOKEN_HEADER: paired["token"]}

    res = await client.post("/api/wristwand/fire", headers=headers, json={"target": "light.lamp", "seq": 1})
    assert (await res.json())["ok"] is True
    res = await client.post("/api/wristwand/fire", headers=headers, json={"target": "light.lamp", "seq": 1})
    assert (await res.json())["duplicate"] is True
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["entity_id"] == ["light.lamp"]
    assert len(events) == 1
    assert events[0].data["watch_name"] == "Balance 3"
    assert events[0].data["target"] == "light.lamp"


async def test_dim_steps_brightness(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "on")
    calls = async_mock_service(hass, "light", "turn_on")
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    await client.post(
        "/api/wristwand/fire",
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
    res = await client.post("/api/wristwand/fire", headers=headers, json={"target": "lock.door", "seq": 1})
    assert await res.json() == {"ok": False, "needsConfirm": True}
    res = await client.post(
        "/api/wristwand/fire", headers=headers, json={"target": "lock.door", "seq": 2, "confirmed": True}
    )
    assert (await res.json())["ok"] is True
    assert len(calls) == 1


async def test_unknown_target(hass, setup_entry, hass_client_no_auth):
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.post(
        "/api/wristwand/fire", headers={TOKEN_HEADER: paired["token"]}, json={"target": "sensor.temp"}
    )
    assert res.status == HTTPStatus.NOT_FOUND


async def test_paired_watches_survive_a_reload(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "off")
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    res = await client.get("/api/wristwand/targets", headers={TOKEN_HEADER: paired["token"]})
    assert res.status == HTTPStatus.OK


async def test_probe_results_become_events(hass, setup_entry, hass_client_no_auth):
    from custom_components.wristwand.const import EVENT_PROBE

    events = async_capture_events(hass, EVENT_PROBE)
    client = await hass_client_no_auth()
    paired = await _pair(hass, client)
    res = await client.post(
        "/api/wristwand/probe", headers={TOKEN_HEADER: paired["token"]}, json={"test": "rates", "results": [1]}
    )
    assert (await res.json())["ok"] is True
    await hass.async_block_till_done()
    assert events[0].data["test"] == "rates"
    assert events[0].data["watch_name"] == "Balance 3"
