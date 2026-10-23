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


async def test_no_watches(hass, setup_entry):
    result = await _open(hass, setup_entry)
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "no_watches"


async def test_paints_can_be_trimmed_removed_and_reassigned(hass, setup_entry):
    watch = await _watch(setup_entry)
    watches = setup_entry.runtime_data
    hass.states.async_set("light.desk", "off", {"friendly_name": "Desk"})
    await watches.async_save_paints(watch["id"], {"light.desk": [SPOT, {**SPOT, "heading": 20}], "switch.fan": [SPOT]})

    # one watch: straight to its menu
    result = await _open(hass, setup_entry)
    assert result["type"] is FlowResultType.MENU and result["step_id"] == "watch"
    result = await _step(hass, result, {"next_step_id": "paints"})
    assert result["step_id"] == "paints"
    result = await _step(hass, result, {"device": "light.desk", "action": "remove_last"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.paints(watch["id"])["light.desk"] == [SPOT]

    result = await _step(hass, await _step(hass, await _open(hass, setup_entry), {"next_step_id": "paints"}), {"device": "light.desk", "action": "remove_last"})
    assert "light.desk" not in watches.paints(watch["id"])  # the last spot: the device goes

    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "paints"})
    result = await _step(hass, result, {"device": "switch.fan", "action": "reassign"})
    assert result["step_id"] == "reassign"
    result = await _step(hass, result, {"entity": "light.desk"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.paints(watch["id"]) == {"light.desk": [SPOT]}
    assert watches.synced(watch["id"])["paints_rev"] == 4

    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "paints"})
    await _step(hass, result, {"device": "light.desk", "action": "remove_all"})
    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "paints"})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "no_paints"


async def test_rooms_can_be_deleted(hass, setup_entry):
    watch = await _watch(setup_entry)
    watches = setup_entry.runtime_data
    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "rooms"})
    assert result["reason"] == "no_rooms"
    await watches.async_save_rooms(watch["id"], {"office": {"name": "Office", "fingerprint": {"AA": [-60, 1]}}})
    result = await _step(hass, await _open(hass, setup_entry), {"next_step_id": "rooms"})
    result = await _step(hass, result, {"room": "office"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert watches.synced(watch["id"])["rooms"] == {}


async def test_settings_with_two_watches(hass, setup_entry):
    await _watch(setup_entry, "First")
    second = await _watch(setup_entry, "Second")
    watches = setup_entry.runtime_data
    result = await _open(hass, setup_entry)
    assert result["step_id"] == "init"
    result = await _step(hass, result, {"watch": second["id"]})
    assert result["type"] is FlowResultType.MENU
    result = await _step(hass, result, {"next_step_id": "settings"})
    base = {"gesture_enabled": True, "gesture_kind": "snap", "gesture_gyro": 200, "away_block": True, "room_source": "sensor"}
    result = await _step(hass, result, base)
    assert result["errors"] == {"away_person": "person_needed", "room_sensor": "sensor_needed"}
    result = await _step(
        hass,
        result,
        {**base, "away_person": "person.me", "away_allowed": ["input_boolean.test"], "room_sensor": "sensor.area"},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    s = watches.synced(second["id"])["settings"]
    assert s["gesture"] == {"enabled": True, "kind": "snap", "gyro": 200.0, "jolt": None, "calibrated": False}
    assert s["away"] == {"block": True, "person": "person.me", "allowed": ["input_boolean.test"]}
    assert s["room"] == {"source": "sensor", "sensor": "sensor.area"}
