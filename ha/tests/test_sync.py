"""What watches keep in sync with Home Assistant: paints, rooms and settings; home network only."""

from http import HTTPStatus

from pytest_homeassistant_custom_component.common import async_mock_service

from homeassistant.helpers import area_registry as ar

from custom_components.kestrel.const import TOKEN_HEADER
from custom_components.kestrel.watchdata import clean_gesture, clean_rooms

SPOT = {"heading": 12.5, "headingSpread": 4, "pitch": 3, "pitchSpread": 2, "n": 30}
ROOM = {"name": "Office", "fingerprint": {"AA:BB:CC:DD:EE:FF": [-60, 1.0]}, "scans": 3, "at": 1}


async def _token(entry, name="Balance 3"):
    watches = entry.runtime_data
    pairing = watches.start_pairing(name)
    _, watch, token = await watches.async_confirm(pairing.pairing_id, pairing.code)
    return watch, token


async def test_sync_returns_everything_with_revisions(hass, setup_entry, hass_client_no_auth):
    ar.async_get(hass).async_create("Office")
    ar.async_get(hass).async_create("Kitchen")
    hass.states.async_set("light.desk", "off", {"friendly_name": "Desk"})
    _, token = await _token(setup_entry)
    client = await hass_client_no_auth()
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: token})
    body = await res.json()
    assert [a["name"] for a in body["areas"]] == ["Kitchen", "Office"]
    assert body["targets"] == [{"id": "light.desk", "name": "Desk"}]  # compact: no empty fields
    assert body["paints"] == {} and body["rooms"] == {} and body["room"] is None
    assert body["paints_rev"] == 0 and body["settings_rev"] == 0 and body["rooms_rev"] == 0
    assert body["settings"]["gesture"] == {"enabled": True, "kind": "flick", "calibrations": {}}
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: "nope"})
    assert res.status == HTTPStatus.UNAUTHORIZED


async def test_paints_rooms_and_gesture_are_saved_per_watch(hass, setup_entry, hass_client_no_auth):
    _, one = await _token(setup_entry)
    _, two = await _token(setup_entry, "Other")
    client = await hass_client_no_auth()
    h1 = {TOKEN_HEADER: one}
    res = await client.post(
        "/api/kestrel/paints",
        headers=h1,
        json={
            "paints": {
                "light.desk": [SPOT] * 20,  # trimmed to the newest 12
                "switch.fan": [{"heading": "x", "pitch": 1}],  # no usable spots: dropped
                "nodot": [SPOT],  # not an entity id: dropped
                "fan.ceiling": "nope",
            }
        },
    )
    body = await res.json()
    assert body["ok"] and body["rev"] == 1 and list(body["paints"]) == ["light.desk"]
    assert len(body["paints"]["light.desk"]) == 12

    res = await client.post("/api/kestrel/rooms", headers=h1, json={"rooms": {"office": ROOM, "bad": {"fingerprint": 1}}})
    assert list((await res.json())["rooms"]) == ["office"]

    gesture = {"kind": "snap", "calibrations": {"snap": {"gyro": 180, "jolt": 95.5}, "wave": {"gyro": 1}}, "enabled": "x"}
    changes = {"gesture": gesture, "dwell": {"enabled": True, "seconds": 2.3}, "nonsense": {}}
    res = await client.post("/api/kestrel/settings", headers=h1, json={"settings": changes})
    body = await res.json()
    assert body["settings"]["gesture"] == {"enabled": True, "kind": "snap", "calibrations": {"snap": {"gyro": 180, "jolt": 95.5}}}
    assert body["settings"]["dwell"] == {"enabled": True, "seconds": 2.5}  # half seconds
    assert "away" not in body["settings"]

    # the other watch has its own
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: two})
    body = await res.json()
    assert body["paints"] == {} and body["rooms"] == {}

    # kept across a reload, with their revisions
    assert await hass.config_entries.async_reload(setup_entry.entry_id)
    await hass.async_block_till_done()
    body = await (await client.get("/api/kestrel/sync", headers=h1)).json()
    assert "light.desk" in body["paints"] and body["paints_rev"] == 1 and body["rooms_rev"] == 1 and body["settings_rev"] == 1

    for path in ("/api/kestrel/paints", "/api/kestrel/rooms", "/api/kestrel/settings"):
        for bad in ([1], {"paints": [1]}, {}):
            assert (await client.post(path, headers=h1, json=bad)).status == HTTPStatus.BAD_REQUEST
        assert (await client.post(path, headers=h1, data="not json")).status == HTTPStatus.BAD_REQUEST
        assert (await client.post(path, headers={TOKEN_HEADER: "nope"}, json={})).status == HTTPStatus.UNAUTHORIZED


async def test_cleaning_settings():
    from custom_components.kestrel.watchdata import clean_settings

    assert clean_settings([1]) == {}
    assert clean_settings({"dwell": {"seconds": 99}, "room": {"source": "sensor", "sensor": "sensor.area"}}) == {
        "dwell": {"seconds": 10.0},
        "room": {"source": "sensor", "sensor": "sensor.area"},
    }
    assert clean_settings({"away": {"block": True}}) == {}  # no such group (away mode is gone)
    assert clean_settings({"room": {"sensor": "light.no"}}) == {"room": {"sensor": None}}


async def test_cleaning_watch_data():
    assert clean_gesture({"calibrations": {"tap": {"gyro": -5, "jolt": "x"}}, "kind": "wave"}) == {"calibrations": {}}
    rooms = clean_rooms({"office": {"fingerprint": {"AA": [-60, 1], "BB": [1], "CC": ["a", 1]}}, 5: ROOM})
    assert rooms == {"office": {"name": "office", "fingerprint": {"AA": [-60.0, 1.0]}, "scans": 0, "at": 0}}
    assert clean_rooms({"x": {"fingerprint": {"BB": [1]}}}) == {}


async def test_room_from_a_sensor(hass, setup_entry, hass_client_no_auth):
    office = ar.async_get(hass).async_create("Office")
    watch, token = await _token(setup_entry)
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    h = {TOKEN_HEADER: token}
    assert (await (await client.get("/api/kestrel/room", headers=h)).json()) == {"room": None}
    settings = watches.synced(watch["id"])["settings"]
    settings["room"] = {"source": "sensor", "sensor": "sensor.watch_area"}
    await watches.async_save_settings(watch["id"], settings)
    assert (await (await client.get("/api/kestrel/room", headers=h)).json()) == {"room": None}  # no sensor state yet
    hass.states.async_set("sensor.watch_area", "office")
    assert (await (await client.get("/api/kestrel/room", headers=h)).json()) == {"room": {"id": office.id, "name": "Office"}}
    hass.states.async_set("sensor.watch_area", "Garage")
    assert (await (await client.get("/api/kestrel/room", headers=h)).json()) == {"room": None}
    hass.states.async_set("sensor.watch_area", "")
    assert (await (await client.get("/api/kestrel/sync", headers=h)).json())["room"] is None
    assert (await client.get("/api/kestrel/room", headers={TOKEN_HEADER: "nope"})).status == HTTPStatus.UNAUTHORIZED


async def test_fire_reports_brightness(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("light.lamp", "on", {"brightness": 128})
    async_mock_service(hass, "homeassistant", "toggle")
    _, token = await _token(setup_entry)
    client = await hass_client_no_auth()
    res = await client.post("/api/kestrel/fire", headers={TOKEN_HEADER: token}, json={"target": "light.lamp", "seq": 1})
    assert (await res.json())["brightness"] == 50


async def test_watches_only_work_on_the_home_network(hass, setup_entry, hass_client_no_auth):
    from unittest.mock import patch

    _, token = await _token(setup_entry)
    client = await hass_client_no_auth()
    with patch("custom_components.kestrel.http.is_cloud_connection", return_value=True):
        for method, path in (("get", "/api/kestrel/sync"), ("post", "/api/kestrel/fire"), ("get", "/api/kestrel/info")):
            res = await getattr(client, method)(path, headers={TOKEN_HEADER: token}, json={"target": "light.x"})
            assert res.status == HTTPStatus.FORBIDDEN, path
            assert (await res.json())["message"] == "Kestrel only works on your home network"


async def test_sync_can_skip_the_target_list(hass, setup_entry, hass_client_no_auth):
    watch, token = await _token(setup_entry)
    client = await hass_client_no_auth()
    body = await (await client.get("/api/kestrel/sync?only=paints", headers={TOKEN_HEADER: token})).json()
    assert body == {"watch_id": watch["id"], "room": None, "paints": {}, "paints_rev": 0}


async def test_sync_sends_only_what_changed(hass, setup_entry, hass_client_no_auth):
    ar.async_get(hass).async_create("Office")
    hass.states.async_set("light.desk", "off", {"friendly_name": "Desk", "supported_color_modes": ["brightness"]})
    watch, token = await _token(setup_entry)
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    h = {TOKEN_HEADER: token}
    full = await (await client.get("/api/kestrel/sync", headers=h)).json()
    assert full["targets"] == [{"id": "light.desk", "name": "Desk", "dimmable": True}]
    have = f"targets:{full['targets_hash']},paints:0,rooms:0,settings:0"

    # nothing changed: only revisions and the hash come back
    body = await (await client.get(f"/api/kestrel/sync?have={have}", headers=h)).json()
    assert body == {
        "watch_id": watch["id"], "room": None, "targets_hash": full["targets_hash"],
        "settings_rev": 0, "paints_rev": 0, "rooms_rev": 0,
    }

    # a paint changed in Home Assistant and a new light appeared: those come back
    await watches.async_save_paints(watch["id"], {"light.desk": [SPOT]})
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch"})
    body = await (await client.get(f"/api/kestrel/sync?have={have}", headers=h)).json()
    assert body["paints"] == {"light.desk": [SPOT]} and body["paints_rev"] == 1
    assert "rooms" not in body and "settings" not in body
    assert [t["id"] for t in body["targets"]] == ["light.desk", "light.porch"]
    assert body["targets_hash"] != full["targets_hash"]


async def test_sync_caps_the_device_list_and_says_so(hass, setup_entry, hass_client_no_auth, monkeypatch):
    monkeypatch.setattr("custom_components.kestrel.http.MAX_TARGETS", 2)
    for name in ("a", "b", "c"):
        hass.states.async_set(f"light.{name}", "off")
    _, token = await _token(setup_entry)
    client = await hass_client_no_auth()
    body = await (await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: token})).json()
    assert [t["id"] for t in body["targets"]] == ["light.a", "light.b"]
    assert body["targets_total"] == 3


def test_thresholds_follow_the_chosen_gesture():
    from custom_components.kestrel.watchdata import thresholds

    cals = {"snap": {"gyro": None, "jolt": 193.0}}
    assert thresholds({"kind": "snap", "calibrations": cals}) == {"gyro": None, "jolt": 193.0}
    assert thresholds({"kind": "flick", "calibrations": cals}) == {"gyro": 600.0, "jolt": None}
    assert thresholds({"kind": "tap", "calibrations": cals}) is None
    assert clean_gesture({"calibrations": {"snap": "nonsense"}}) == {"calibrations": {}}
