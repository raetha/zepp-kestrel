"""The options flow: manage each watch's paints, rooms and settings."""

from homeassistant.data_entry_flow import FlowResultType

SPOT = {"heading": 10, "pitch": 2}


async def _watch(entry, name="Balance 3"):
    watches = entry.runtime_data
    pairing = watches.start_pairing(name)
    _, watch, _ = await watches.async_confirm(pairing.pairing_id, pairing.code)
    return watch


async def _open(hass, entry):
    result = await hass.config_entries.options.async_init(entry.entry_id)
    return result


async def _step(hass, result, data):
    return await hass.config_entries.options.async_configure(result["flow_id"], data)


async def _watch_menu(hass, entry):
    """Configure with one watch: Kestrel's menu, then that watch's menu."""
    return await _step(hass, await _open(hass, entry), {"next_step_id": "watch"})


async def test_no_watches_only_offers_devices(hass, setup_entry):
    result = await _open(hass, setup_entry)
    assert result["type"] is FlowResultType.MENU and result["menu_options"] == ["offered"]


async def test_paints_can_be_trimmed_removed_and_reassigned(hass, setup_entry):
    watch = await _watch(setup_entry)
    watches = setup_entry.runtime_data
    hass.states.async_set("light.desk", "off", {"friendly_name": "Desk"})
    await watches.async_save_paints(watch["id"], {"light.desk": [SPOT, {**SPOT, "heading": 20}], "switch.fan": [SPOT]})

    # one watch: Kestrel's menu offers it directly
    result = await _open(hass, setup_entry)
    assert result["menu_options"] == ["offered", "watch"]
    result = await _step(hass, result, {"next_step_id": "watch"})
    assert result["type"] is FlowResultType.MENU and result["step_id"] == "watch"
    result = await _step(hass, result, {"next_step_id": "paints"})
    assert result["step_id"] == "paints"
    result = await _step(hass, result, {"device": "light.desk", "action": "remove_last"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.paints(watch["id"])["light.desk"] == [SPOT]

    result = await _step(hass, await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "paints"}), {"device": "light.desk", "action": "remove_last"})
    assert "light.desk" not in watches.paints(watch["id"])  # the last spot: the device goes

    result = await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "paints"})
    result = await _step(hass, result, {"device": "switch.fan", "action": "reassign"})
    assert result["step_id"] == "reassign"
    result = await _step(hass, result, {"entity": "light.desk"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.paints(watch["id"]) == {"light.desk": [SPOT]}
    assert watches.synced(watch["id"])["paints_rev"] == 4

    result = await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "paints"})
    await _step(hass, result, {"device": "light.desk", "action": "remove_all"})
    result = await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "paints"})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "no_paints"


async def test_rooms_can_be_deleted(hass, setup_entry):
    watch = await _watch(setup_entry)
    watches = setup_entry.runtime_data
    result = await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "rooms"})
    assert result["reason"] == "no_rooms"
    await watches.async_save_rooms(watch["id"], {"office": {"name": "Office", "fingerprint": {"AA": [-60, 1]}}})
    result = await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "rooms"})
    result = await _step(hass, result, {"room": "office"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.synced(watch["id"])["rooms"] == {}


async def test_settings_with_two_watches(hass, setup_entry):
    await _watch(setup_entry, "First")
    second = await _watch(setup_entry, "Second")
    watches = setup_entry.runtime_data
    result = await _open(hass, setup_entry)
    assert result["menu_options"] == ["offered", "pick_watch"]
    result = await _step(hass, result, {"next_step_id": "pick_watch"})
    result = await _step(hass, result, {"watch": second["id"]})
    assert result["type"] is FlowResultType.MENU
    result = await _step(hass, result, {"next_step_id": "settings"})
    base = {
        "gesture_enabled": True, "gesture_kind": "snap", "gesture_gyro": 200, "room_source": "sensor",
        "dwell_enabled": True, "dwell_seconds": 4,
    }
    result = await _step(hass, result, base)
    assert result["errors"] == {"room_sensor": "sensor_needed"}
    result = await _step(
        hass,
        result,
        {**base, "room_sensor": "sensor.area"},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    s = watches.synced(second["id"])["settings"]
    # the thresholds were the current gesture's (flick); snap is chosen, still uncalibrated
    assert s["gesture"] == {"enabled": True, "kind": "snap", "calibrations": {"flick": {"gyro": 200.0, "jolt": None}}}
    assert "away" not in s
    assert s["room"] == {"source": "sensor", "sensor": "sensor.area"}
    assert s["dwell"] == {"enabled": True, "seconds": 4.0}


async def test_empty_thresholds_forget_the_current_gestures_calibration(hass, setup_entry):
    watch = await _watch(setup_entry, "Third")
    watches = setup_entry.runtime_data
    await watches.async_update_settings(watch["id"], {"gesture": {"kind": "snap", "calibrations": {"snap": {"jolt": 193}, "flick": {"gyro": 900}}}})
    result = await _step(hass, await _watch_menu(hass, setup_entry), {"next_step_id": "settings"})
    assert result["description_placeholders"] == {"kind": "snap"}
    result = await _step(hass, result, {"gesture_enabled": True, "gesture_kind": "snap", "room_source": "watch", "dwell_enabled": False, "dwell_seconds": 3})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.synced(watch["id"])["settings"]["gesture"]["calibrations"] == {"flick": {"gyro": 900.0, "jolt": None}}


async def test_devices_for_watches_narrow_what_they_can_use(hass, setup_entry, hass_client_no_auth):
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from homeassistant.helpers import device_registry as dr, entity_registry as er

    from custom_components.kestrel.const import TOKEN_HEADER

    other = MockConfigEntry(domain="test")
    other.add_to_hass(hass)
    dev_reg, ent_reg = dr.async_get(hass), er.async_get(hass)
    fixture = dev_reg.async_get_or_create(config_entry_id=other.entry_id, identifiers={("test", "fixture")})
    for name in ("left", "right"):
        e = ent_reg.async_get_or_create("light", "test", name, suggested_object_id=name, device_id=fixture.id)
        hass.states.async_set(e.entity_id, "off")
    hass.states.async_set("switch.fan", "off")
    hass.states.async_set("lock.door", "locked")

    watch = await _watch(setup_entry)
    _, token = None, None
    watches = setup_entry.runtime_data
    pairing = watches.start_pairing("Second")
    _, _, token = await watches.async_confirm(pairing.pairing_id, pairing.code)

    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "offered"})
    assert result["step_id"] == "offered"
    result = await _step(hass, result, {"devices": [fixture.id], "entities": ["switch.fan"]})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()  # reloaded with the new choice
    assert setup_entry.options == {"devices": [fixture.id], "entities": ["switch.fan"]}

    client = await hass_client_no_auth()
    h = {TOKEN_HEADER: token}
    body = await (await client.get("/api/kestrel/targets", headers=h)).json()
    assert {t["id"] for t in body["targets"]} == {"light.left", "light.right", "switch.fan"}
    res = await client.post("/api/kestrel/fire", headers=h, json={"target": "lock.door", "confirmed": True})
    assert res.status == 404  # not chosen: not offered
    assert watch["id"] in setup_entry.runtime_data.watches  # watches survive the reload

    # choosing nothing offers everything again
    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "offered"})
    result = await _step(hass, result, {})
    await hass.async_block_till_done()
    body = await (await client.get("/api/kestrel/targets", headers=h)).json()
    assert "lock.door" in {t["id"] for t in body["targets"]}
