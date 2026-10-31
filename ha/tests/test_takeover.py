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
