"""Each paired watch's sensors and switches."""

from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory

from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.kestrel.const import DOMAIN, TOKEN_HEADER

SPOT = {"heading": 12.5, "headingSpread": 4, "pitch": 3, "pitchSpread": 2, "n": 30}


async def _token(hass, entry, name="Balance 3"):
    watches = entry.runtime_data
    pairing = watches.start_pairing(name)
    _, watch, token = await watches.async_confirm(pairing.pairing_id, pairing.code)
    await hass.async_block_till_done()
    return watch, token


def _entity(hass, watch_id, key, platform):
    return er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{watch_id}_{key}")


async def test_a_paired_watch_gets_its_entities(hass, setup_entry):
    watch, _ = await _token(hass, setup_entry)
    reg = er.async_get(hass)
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, watch["id"]), setup_entry.entry_id)
    ids = {e.unique_id for e in er.async_entries_for_device(reg, device.id)}
    assert ids == {
        f"{watch['id']}_{k}"
        for k in ("last_triggered", "room", "last_seen", "address", "painted_devices", "calibrated_rooms", "gesture", "away_mode", "gesture_kind")
    }
    assert hass.states.get(_entity(hass, watch["id"], "painted_devices", "sensor")).state == "0"
    assert hass.states.get(_entity(hass, watch["id"], "last_triggered", "sensor")).state == "unknown"
    assert hass.states.get(_entity(hass, watch["id"], "gesture", "switch")).state == "on"
    assert hass.states.get(_entity(hass, watch["id"], "away_mode", "switch")).state == "off"


async def test_requests_report_last_seen_address_version_and_room(
    hass, setup_entry, hass_client_no_auth, freezer: FrozenDateTimeFactory
):
    kitchen = ar.async_get(hass).async_create("Kitchen")
    watch, token = await _token(hass, setup_entry)
    client = await hass_client_no_auth()
    h = {TOKEN_HEADER: token}
    await client.get("/api/kestrel/sync?v=0.1.0-dev.37", headers=h)
    await hass.async_block_till_done()

    address = hass.states.get(_entity(hass, watch["id"], "address", "sensor")).state
    assert address.startswith("http://127.0.0.1:")
    seen = hass.states.get(_entity(hass, watch["id"], "last_seen", "sensor")).state
    assert dt_util.parse_datetime(seen) is not None
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, watch["id"]), setup_entry.entry_id)
    assert device.sw_version == "0.1.0-dev.37"

    await client.get(f"/api/kestrel/room?here={kitchen.id}", headers=h)
    await client.get("/api/kestrel/room?here=nowhere", headers=h)  # unknown areas are ignored
    await hass.async_block_till_done()
    room = hass.states.get(_entity(hass, watch["id"], "room", "sensor"))
    assert room.state == "Kitchen" and room.attributes["area_id"] == kitchen.id

    # "last seen" alone moves on at most once a minute
    freezer.tick(timedelta(seconds=10))
    await client.get("/api/kestrel/room", headers=h)
    await hass.async_block_till_done()
    assert hass.states.get(_entity(hass, watch["id"], "last_seen", "sensor")).state == seen
    freezer.tick(timedelta(seconds=60))
    await client.get("/api/kestrel/room", headers=h)
    await hass.async_block_till_done()
    assert hass.states.get(_entity(hass, watch["id"], "last_seen", "sensor")).state != seen


async def test_last_triggered_and_counts(hass, setup_entry, hass_client_no_auth):
    kitchen = ar.async_get(hass).async_create("Kitchen")
    hass.states.async_set("light.pendants", "off", {"friendly_name": "Pendants"})
    watch, token = await _token(hass, setup_entry)
    client = await hass_client_no_auth()
    body = {"target": "light.pendants", "action": "toggle", "via": "flick", "room": kitchen.id, "seq": 1}
    res = await client.post("/api/kestrel/fire", json=body, headers={TOKEN_HEADER: token})
    assert (await res.json())["ok"]
    await hass.async_block_till_done()

    fired = hass.states.get(_entity(hass, watch["id"], "last_triggered", "sensor"))
    assert fired.state == "Pendants"
    assert fired.attributes["entity_id"] == "light.pendants"
    assert fired.attributes["via"] == "flick" and fired.attributes["room"] == "Kitchen"
    assert hass.states.get(_entity(hass, watch["id"], "room", "sensor")).state == "Kitchen"

    watches = setup_entry.runtime_data
    await watches.async_save_paints(watch["id"], {"light.pendants": [SPOT]})
    await hass.async_block_till_done()
    assert hass.states.get(_entity(hass, watch["id"], "painted_devices", "sensor")).state == "1"
    assert hass.states.get(_entity(hass, watch["id"], "calibrated_rooms", "sensor")).state == "0"


async def test_switches_change_the_watch_settings(hass, setup_entry):
    watch, _ = await _token(hass, setup_entry)
    watches = setup_entry.runtime_data
    gesture = _entity(hass, watch["id"], "gesture", "switch")
    away = _entity(hass, watch["id"], "away_mode", "switch")

    await hass.services.async_call("switch", "turn_off", {"entity_id": gesture}, blocking=True)
    await hass.services.async_call("switch", "turn_on", {"entity_id": away}, blocking=True)
    settings = watches.synced(watch["id"])
    assert settings["settings"]["gesture"]["enabled"] is False
    assert settings["settings"]["away"]["block"] is True
    assert settings["settings_rev"] == 2  # the watch picks it up on its next sync
    assert hass.states.get(gesture).state == "off"
    assert hass.states.get(away).state == "on"


async def test_entities_go_unavailable_when_the_watch_is_unpaired(hass, setup_entry):
    watch, _ = await _token(hass, setup_entry)
    entity_id = _entity(hass, watch["id"], "room", "sensor")
    await setup_entry.runtime_data.async_remove([watch["id"]])
    hass.states.async_set("light.x", "on")  # unrelated change; the entity reports on its next update
    sensor = hass.data["entity_components"]["sensor"].get_entity(entity_id)
    assert sensor.available is False


async def test_unload_removes_the_entities(hass, setup_entry):
    watch, _ = await _token(hass, setup_entry)
    entity_id = _entity(hass, watch["id"], "room", "sensor")
    assert await hass.config_entries.async_unload(setup_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(entity_id).state == "unavailable"


async def test_gesture_select_switches_between_calibrations(hass, setup_entry):
    watch, _ = await _token(hass, setup_entry)
    watches = setup_entry.runtime_data
    await watches.async_update_gesture(watch["id"], {"calibrations": {"snap": {"jolt": 193}}})
    select = _entity(hass, watch["id"], "gesture_kind", "select")
    assert hass.states.get(select).state == "flick"
    await hass.services.async_call("select", "select_option", {"entity_id": select, "option": "snap"}, blocking=True)
    gesture = watches.synced(watch["id"])["settings"]["gesture"]
    assert gesture["kind"] == "snap" and gesture["calibrations"]["snap"] == {"gyro": None, "jolt": 193.0}
    assert hass.states.get(select).state == "snap"
