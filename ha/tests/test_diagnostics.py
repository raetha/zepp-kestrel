"""Diagnostics levels, retention, and what a diagnostics download may contain."""

import json
from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory

from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.kestrel.const import DOMAIN, EVENT_PROBE, PROBES_MAX_AGE, TOKEN_HEADER
from custom_components.kestrel.diagnostics import async_get_config_entry_diagnostics, async_get_device_diagnostics
from custom_components.kestrel.watchdata import clean_settings, settings_of

MAC1, MAC2 = "1C:69:20:80:10:C2", "ac:27:6e:7c:28:c6"


async def _token(hass, entry, name="Balance 3"):
    watches = entry.runtime_data
    pairing = watches.start_pairing(name)
    _, watch, token = await watches.async_confirm(pairing.pairing_id, pairing.code)
    await hass.async_block_till_done()
    return watch, token


async def _probe(client, token, body):
    res = await client.post("/api/kestrel/probe", json=body, headers={TOKEN_HEADER: token})
    assert res.status == 200
    return await res.json()


async def test_what_the_watch_records_is_kept_only_with_detailed_diagnostics(
    hass, setup_entry, hass_client_no_auth, freezer: FrozenDateTimeFactory
):
    watches = setup_entry.runtime_data
    watch, token = await _token(hass, setup_entry)
    client = await hass_client_no_auth()
    events = async_capture_events(hass, EVENT_PROBE)

    # off (the default): aim traces, room scans and plain trails are dropped; a trail with an error is kept
    assert (await _probe(client, token, {"test": "point", "trace": [[0, 1]]}))["kept"] is False
    assert (await _probe(client, token, {"test": "room", "scans": []}))["kept"] is False
    assert (await _probe(client, token, {"test": "paint", "trace": [[0, 1]]}))["kept"] is False
    assert (await _probe(client, token, {"test": "trail", "trail": [[1, "open", "home"]]}))["kept"] is False
    assert (await _probe(client, token, {"test": "trail", "trail": [[1, "error", {"where": "x"}]]}))["kept"] is True
    # probes run on purpose are always kept, and only they become events
    assert (await _probe(client, token, {"test": "rates"}))["kept"] is True
    assert [p["test"] for p in watches.probes_for()] == ["trail", "rates"]
    await hass.async_block_till_done()
    assert [e.data["test"] for e in events] == ["rates"]

    # on, from the switch: kept, for a week
    switch = er.async_get(hass).async_get_entity_id("switch", DOMAIN, f"{watch['id']}_detailed_diagnostics")
    await hass.services.async_call("switch", "turn_on", {"entity_id": switch}, blocking=True)
    state = hass.states.get(switch)
    assert state.state == "on" and state.attributes["until"]
    assert (await _probe(client, token, {"test": "point", "trace": [[0, 1]]}))["kept"] is True
    assert settings_of(watches.watches[watch["id"]])["diagnostics"]["detailed"] is True

    # ... then off by itself
    freezer.tick(timedelta(days=8))
    assert settings_of(watches.watches[watch["id"]])["diagnostics"]["detailed"] is False
    assert (await _probe(client, token, {"test": "point", "trace": [[0, 1]]}))["kept"] is False
    await hass.services.async_call("switch", "turn_off", {"entity_id": switch}, blocking=True)
    assert hass.states.get(switch).attributes["until"] is None

    # a watch can't turn it on itself
    assert clean_settings({"diagnostics": {"detailed": True, "until": 9e12}}) == {}

    # old results are dropped
    watches.add_probe(watch, {"test": "rates", "old": True})
    freezer.tick(timedelta(seconds=PROBES_MAX_AGE + 60))
    watches.add_probe(watch, {"test": "rates", "new": True})
    assert [p.get("new") for p in watches.probes_for()] == [True]


async def test_options_keep_and_set_detailed_diagnostics(hass, setup_entry):
    watches = setup_entry.runtime_data
    watch, _ = await _token(hass, setup_entry)
    result = await hass.config_entries.options.async_init(setup_entry.entry_id)
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "watch"})
    result = await hass.config_entries.options.async_configure(result["flow_id"], {"next_step_id": "settings"})
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"gesture_enabled": True, "gesture_kind": "flick", "room_source": "watch", "dwell_enabled": False,
         "dwell_seconds": 3, "detailed_diagnostics": True},
    )
    assert settings_of(watches.watches[watch["id"]])["diagnostics"]["detailed"] is True


async def test_a_download_has_no_tokens_addresses_or_bluetooth_addresses(hass, setup_entry, hass_client_no_auth):
    watches = setup_entry.runtime_data
    watch, token = await _token(hass, setup_entry)
    client = await hass_client_no_auth()
    await client.get("/api/kestrel/sync", headers={TOKEN_HEADER: token})  # records the address it came from
    await watches.async_save_rooms(watch["id"], {"kitchen": {"name": "Kitchen", "fingerprint": {MAC1: [-70, 1], MAC2: [-80, 1]}}})
    await watches.async_set_detailed_diagnostics(watch["id"], True)
    await _probe(client, token, {"test": "room", "scans": [[{"mac": MAC1, "rssi": -66}], [{"mac": MAC2.upper(), "rssi": -80}]]})

    diag = await async_get_config_entry_diagnostics(hass, setup_entry)
    text = json.dumps(diag)
    assert token not in text and watch["token_hash"] not in text
    for mac in (MAC1, MAC2, MAC2.upper(), "127.0.0.1"):
        assert mac not in text
    fp = diag["watches"][0]["rooms"]["kitchen"]["fingerprint"]
    scans = diag["probes"][0]["scans"]
    # the same address gets the same pseudonym throughout a download, so room matching can be replayed
    assert scans[0][0]["mac"] in fp and scans[1][0]["mac"] in fp
    assert diag["watches"][0]["status"]["address"] == "**REDACTED**"

    device = dr.async_get(hass).async_get_device_by_identifier((DOMAIN, watch["id"]), setup_entry.entry_id)
    again = await async_get_device_diagnostics(hass, setup_entry, device)
    assert MAC1 not in json.dumps(again)
    # pseudonyms change from one download to the next
    assert set(again["watch"]["rooms"]["kitchen"]["fingerprint"]) != set(fp)
