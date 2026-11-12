"""A watch paired again, or a new watch, takes over an earlier setup (paints, rooms, settings)."""

from http import HTTPStatus

from homeassistant.helpers import device_registry as dr

from custom_components.kestrel import async_remove_config_entry_device
from custom_components.kestrel.diagnostics import async_get_config_entry_diagnostics
from custom_components.kestrel.const import DOMAIN, TOKEN_HEADER

PAINT = {"light.lamp": [{"heading": 10, "headingSpread": 4, "pitch": 5, "pitchSpread": 2}]}
ROOMS = {"kitchen": {"name": "Kitchen", "fingerprint": {"AA:BB:CC:DD:EE:01": [-60, 1]}, "scans": 3, "at": 1}}


async def _pair(hass, client, name):
    res = await client.post("/api/kestrel/pair", json={"watch_name": name})
    pairing_id = (await res.json())["pairing_id"]
    code = hass.config_entries.async_loaded_entries(DOMAIN)[0].runtime_data.pairings[pairing_id].code
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    assert res.status == HTTPStatus.OK
    return await res.json()


async def _take_over(client, token, source):
    return await client.post("/api/kestrel/takeover", json={"from": source}, headers={TOKEN_HEADER: token})


async def test_a_watch_paired_again_takes_over_its_old_setup(hass, setup_entry, hass_client_no_auth):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    first = await _pair(hass, client, "Balance 3")
    assert first["setups"] == []  # nothing to take over yet
    await watches.async_save_paints(first["watch_id"], PAINT)
    await watches.async_save_rooms(first["watch_id"], ROOMS)

    again = await _pair(hass, client, "Balance 3")
    assert again["setups"] == [{"id": first["watch_id"], "name": "Balance 3", "paints": 1, "rooms": 1, "removed": False}]
    res = await _take_over(client, again["token"], first["watch_id"])
    assert res.status == HTTPStatus.OK and (await res.json())["watch_id"] == first["watch_id"]
    await hass.async_block_till_done()

    # the new token now belongs to the old watch: same id, device and paints; the extra record is gone
    assert list(watches.watches) == [first["watch_id"]]
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: again["token"]})
    body = await res.json()
    assert body["watch_id"] == first["watch_id"] and body["paints"] == PAINT
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: first["token"]})
    assert res.status == HTTPStatus.UNAUTHORIZED  # the old token no longer works
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), setup_entry.entry_id)
    assert [ident for d in devices for _dom, ident in d.identifiers] == [first["watch_id"]]


async def test_a_removed_watch_setup_is_kept_for_the_next_pairing(hass, setup_entry, hass_client_no_auth):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    old = await _pair(hass, client, "Old watch")
    await watches.async_save_paints(old["watch_id"], PAINT)
    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, old["watch_id"]), setup_entry.entry_id)
    assert await async_remove_config_entry_device(hass, setup_entry, device)
    assert old["watch_id"] in watches.removed
    diag = await async_get_config_entry_diagnostics(hass, setup_entry)
    assert diag["removed_setups"] == [{"name": "Old watch", "removed_at": diag["removed_setups"][0]["removed_at"], "paints": 1, "rooms": 0}]

    new = await _pair(hass, client, "New watch")
    assert new["setups"] == [{"id": old["watch_id"], "name": "Old watch", "paints": 1, "rooms": 0, "removed": True}]
    res = await _take_over(client, new["token"], old["watch_id"])
    assert (await res.json())["watch_id"] == new["watch_id"]
    assert watches.paints(new["watch_id"]) == PAINT and not watches.removed
    # taken: it can't be taken again
    res = await _take_over(client, new["token"], old["watch_id"])
    assert res.status == HTTPStatus.NOT_FOUND


async def test_take_over_only_just_after_pairing(hass, setup_entry, hass_client_no_auth, freezer):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    a = await _pair(hass, client, "A")
    await watches.async_save_paints(a["watch_id"], PAINT)
    b = await _pair(hass, client, "B")
    freezer.tick(601)
    res = await _take_over(client, b["token"], a["watch_id"])
    assert res.status == HTTPStatus.NOT_FOUND
    assert len(watches.watches) == 2
    # nonsense
    res = await client.post("/api/kestrel/takeover", data="x", headers={TOKEN_HEADER: b["token"]})
    assert res.status == HTTPStatus.BAD_REQUEST
    res = await _take_over(client, b["token"], b["watch_id"])
    assert res.status == HTTPStatus.NOT_FOUND


async def test_removed_setups_are_dropped_after_30_days(hass, setup_entry, hass_client_no_auth, freezer):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    old = await _pair(hass, client, "Old")
    await watches.async_save_paints(old["watch_id"], PAINT)
    await watches.async_remove([old["watch_id"]])
    freezer.tick(31 * 86400)
    new = await _pair(hass, client, "New")
    assert new["setups"] == []


async def _pair_with_id(hass, client, name, device_id):
    res = await client.post("/api/kestrel/pair", json={"watch_name": name, "device_id": device_id})
    pairing_id = (await res.json())["pairing_id"]
    code = hass.config_entries.async_loaded_entries(DOMAIN)[0].runtime_data.pairings[pairing_id].code
    res = await client.post("/api/kestrel/pair/confirm", json={"pairing_id": pairing_id, "code": code})
    return await res.json()


async def test_the_same_watch_paired_again_gets_its_own_record_back(hass, setup_entry, hass_client_no_auth):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    first = await _pair_with_id(hass, client, "Balance 3", "a" * 32)
    await watches.async_save_paints(first["watch_id"], PAINT)
    assert watches.watches[first["watch_id"]]["hardware"] != "a" * 32  # only a hash is kept

    again = await _pair_with_id(hass, client, "Balance 3", "a" * 32)
    assert again["watch_id"] == first["watch_id"] and list(watches.watches) == [first["watch_id"]]
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: again["token"]})
    assert (await res.json())["paints"] == PAINT
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: first["token"]})
    assert res.status == HTTPStatus.UNAUTHORIZED

    # another watch is another record
    other = await _pair_with_id(hass, client, "Balance 3", "b" * 32)
    assert other["watch_id"] != first["watch_id"]
    # nonsense ids are ignored
    junk = await _pair_with_id(hass, client, "Old", "x")
    assert "hardware" not in watches.watches[junk["watch_id"]]

    diag = await async_get_config_entry_diagnostics(hass, setup_entry)
    assert all(w.get("hardware") in (None, "**REDACTED**") for w in diag["watches"])


async def test_a_watch_paired_before_ids_learns_its_id_from_a_sync(hass, setup_entry, hass_client_no_auth):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    old = await _pair(hass, client, "Balance 3")
    await watches.async_save_paints(old["watch_id"], PAINT)
    await client.get(f"/api/kestrel/sync?d={'c' * 32}", headers={TOKEN_HEADER: old["token"]})
    assert watches.watches[old["watch_id"]].get("hardware")
    # a second record syncing the same id doesn't claim it (the first one is that watch)
    second = await _pair(hass, client, "Balance 3")
    await client.get(f"/api/kestrel/sync?d={'c' * 32}", headers={TOKEN_HEADER: second["token"]})
    assert not watches.watches[second["watch_id"]].get("hardware")
    # and pairing again with it finds the first
    again = await _pair_with_id(hass, client, "Balance 3", "c" * 32)
    assert again["watch_id"] == old["watch_id"]


async def test_configure_can_give_a_watch_another_watch_setup(hass, setup_entry, hass_client_no_auth, freezer):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    old = await _pair(hass, client, "Balance 3")
    await watches.async_save_paints(old["watch_id"], PAINT)
    new = await _pair(hass, client, "Balance 3")
    freezer.tick(3600)  # long after pairing: Configure isn't limited to that

    result = await hass.config_entries.options.async_init(setup_entry.entry_id)
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "pick_watch"})
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"watch": new["watch_id"]})
    assert "take_over" in result["menu_options"]
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "take_over"})
    assert result["step_id"] == "take_over"
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"source": old["watch_id"]})
    assert result["type"] == "create_entry"
    await hass.async_block_till_done()
    assert list(watches.watches) == [old["watch_id"]]
    res = await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: new["token"]})
    assert (await res.json())["paints"] == PAINT


async def test_lists_use_the_name_given_in_home_assistant(hass, setup_entry, hass_client_no_auth):
    watches = setup_entry.runtime_data
    client = await hass_client_no_auth()
    old = await _pair(hass, client, "Amazfit watch")
    await watches.async_save_paints(old["watch_id"], PAINT)
    dev_reg = dr.async_get(hass)
    device = dev_reg.async_get_device_by_identifier((DOMAIN, old["watch_id"]), setup_entry.entry_id)
    dev_reg.async_update_device(device.id, name_by_user="Old Balance")
    new = await _pair(hass, client, "Amazfit watch")
    assert new["setups"][0]["name"] == "Old Balance"

    result = await hass.config_entries.options.async_init(setup_entry.entry_id)
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "pick_watch"})
    labels = {o["value"]: o["label"] for o in result["data_schema"].schema["watch"].config["options"]}
    assert labels[old["watch_id"]].startswith("Old Balance (1 painted, paired ")
    assert labels[new["watch_id"]].startswith("Amazfit watch (0 painted, paired ")

    # removed: the setup keeps the name it had
    await watches.async_remove([old["watch_id"]])
    assert watches.removed[old["watch_id"]]["name"] == "Old Balance"
