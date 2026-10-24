"""Twist volume with its limits, actions as virtual spots, the paint map, and the newer settings."""

from homeassistant.components.media_player import MediaPlayerEntityFeature
from homeassistant.helpers import area_registry as ar, entity_registry as er
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.kestrel.const import DOMAIN, TOKEN_HEADER
from custom_components.kestrel.paintmap import render
from custom_components.kestrel.watchdata import clean_paints, clean_settings, settings_of

VOLUME = MediaPlayerEntityFeature.VOLUME_SET | MediaPlayerEntityFeature.PLAY


async def _token(hass, entry, name="Balance 3"):
    watches = entry.runtime_data
    pairing = watches.start_pairing(name)
    _, watch, token = await watches.async_confirm(pairing.pairing_id, pairing.code)
    await hass.async_block_till_done()
    return watch, token


def _entity(hass, watch_id, key, platform):
    return er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{watch_id}_{key}")


async def _fire(client, token, **body):
    res = await client.post("/api/kestrel/fire", json=body, headers={TOKEN_HEADER: token})
    return await res.json()


async def test_twisting_volume_is_limited_per_twist_capped_and_spaced(
    hass, setup_entry, hass_client_no_auth, freezer
):
    hass.states.async_set("media_player.den", "playing", {"volume_level": 0.3, "supported_features": VOLUME})
    calls = async_mock_service(hass, "media_player", "volume_set")
    watch, token = await _token(hass, setup_entry)
    client = await hass_client_no_auth()

    # the target says it takes volume
    res = await client.get("/api/kestrel/targets", headers={TOKEN_HEADER: token})
    den = next(t for t in (await res.json())["targets"] if t["id"] == "media_player.den")
    assert den["volume"] is True

    # a huge twist moves it by the step limit (20%) only
    r = await _fire(client, token, target="media_player.den", action="volume", value=90, seq=1)
    assert r["ok"] and r["limited"] is True
    assert calls[-1].data["volume_level"] == 0.5

    # a second twist within a second is refused
    r = await _fire(client, token, target="media_player.den", action="volume", value=10, seq=2)
    assert r["ok"] is False and "Too fast" in r["error"]

    # never above the ceiling (80%) by twisting
    freezer.tick(2)
    hass.states.async_set("media_player.den", "playing", {"volume_level": 0.75, "supported_features": VOLUME})
    r = await _fire(client, token, target="media_player.den", action="volume", value=20, seq=3)
    assert calls[-1].data["volume_level"] == 0.8 and r["limited"] is True and r["volume"] == 80

    # already above it (set elsewhere): twisting up leaves it, twisting down works
    freezer.tick(2)
    hass.states.async_set("media_player.den", "playing", {"volume_level": 0.9, "supported_features": VOLUME})
    await _fire(client, token, target="media_player.den", action="volume", value=10, seq=4)
    assert calls[-1].data["volume_level"] == 0.9
    freezer.tick(2)
    r = await _fire(client, token, target="media_player.den", action="volume", value=-10, seq=5)
    assert calls[-1].data["volume_level"] == 0.8 and r["limited"] is False

    # limits come from the watch's settings
    await setup_entry.runtime_data.async_update_settings(watch["id"], {"volume": {"max": 100, "step": 50}})
    freezer.tick(2)
    hass.states.async_set("media_player.den", "playing", {"volume_level": 0.1, "supported_features": VOLUME})
    await _fire(client, token, target="media_player.den", action="volume", value="40", seq=6)
    assert calls[-1].data["volume_level"] == 0.5

    # a player that doesn't report its volume
    freezer.tick(2)
    hass.states.async_set("media_player.den", "idle", {"supported_features": VOLUME})
    r = await _fire(client, token, target="media_player.den", action="volume", value=10, seq=7)
    assert r["ok"] is False and "volume" in r["error"]

    # nonsense values move nothing
    freezer.tick(2)
    hass.states.async_set("media_player.den", "playing", {"volume_level": 0.4, "supported_features": VOLUME})
    await _fire(client, token, target="media_player.den", action="volume", value="loud", seq=8)
    assert calls[-1].data["volume_level"] == 0.4


async def test_scripts_scenes_and_input_buttons_run(hass, setup_entry, hass_client_no_auth):
    hass.states.async_set("input_button.doorbell", "unknown")
    hass.states.async_set("script.movie_time", "off")
    presses = async_mock_service(hass, "input_button", "press")
    runs = async_mock_service(hass, "script", "turn_on")
    _, token = await _token(hass, setup_entry)
    client = await hass_client_no_auth()
    assert (await _fire(client, token, target="input_button.doorbell", seq=1))["ok"]
    assert (await _fire(client, token, target="script.movie_time", seq=2))["ok"]
    assert len(presses) == 1 and len(runs) == 1


async def test_new_settings_are_entities_and_cleaned(hass, setup_entry):
    watch, _ = await _token(hass, setup_entry)
    s = settings_of(watch)
    assert s["start"] == {"point": False} and s["learn"] == {"enabled": True} and s["volume"] == {"max": 80, "step": 20}

    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": _entity(hass, watch["id"], "open_on_point", "switch")}, blocking=True
    )
    await hass.services.async_call(
        "switch", "turn_off", {"entity_id": _entity(hass, watch["id"], "learn", "switch")}, blocking=True
    )
    await hass.services.async_call(
        "number", "set_value", {"entity_id": _entity(hass, watch["id"], "volume_limit", "number"), "value": 45}, blocking=True
    )
    await hass.services.async_call(
        "number", "set_value",
        {"entity_id": _entity(hass, watch["id"], "volume_step_limit", "number"), "value": 10}, blocking=True,
    )
    s = settings_of(setup_entry.runtime_data.watches[watch["id"]])
    assert s["start"]["point"] is True and s["learn"]["enabled"] is False
    assert s["volume"] == {"max": 45, "step": 10}

    assert clean_settings({"volume": {"max": 7, "step": 999}, "start": {"point": "yes"}, "learn": {"enabled": 1}}) == {
        "volume": {"max": 10, "step": 50}
    }


def test_paints_keep_known_spot_fields_only():
    spot = {"heading": 10, "pitch": 2, "headingSpread": 3, "kind": "learned", "uses": 4, "room": "k" * 100, "evil": "<x>"}
    out = clean_paints({"light.a": [spot, {"heading": 1, "pitch": 1, "kind": "bogus"}]})["light.a"]
    assert out[0] == {"heading": 10, "pitch": 2, "headingSpread": 3, "uses": 4, "room": "k" * 64, "kind": "learned"}
    assert "kind" not in out[1]


async def test_paint_map_draws_each_room(hass, setup_entry, hass_client):
    kitchen = ar.async_get(hass).async_create("Kitchen")
    hass.states.async_set("light.island", "on", {"friendly_name": "Island <light>"})
    watch, _ = await _token(hass, setup_entry)
    entity_id = _entity(hass, watch["id"], "paint_map", "image")
    first = hass.states.get(entity_id).state

    watches = setup_entry.runtime_data
    paints = {
        "light.island": [
            {"heading": 277, "headingSpread": 6, "pitch": 24, "pitchSpread": 1, "room": kitchen.id},
            {"heading": 280, "headingSpread": 4, "pitch": 23, "pitchSpread": 3, "room": kitchen.id, "kind": "learned"},
            {"heading": 279, "headingSpread": 4, "pitch": 22, "pitchSpread": 3, "room": kitchen.id, "kind": "correction"},
        ],
        "light.lamp": [{"heading": 10, "headingSpread": 200, "pitch": -10, "pitchSpread": 2}],
    }
    await watches.async_save_paints(watch["id"], paints)
    await hass.async_block_till_done()
    assert hass.states.get(entity_id).state != first  # the picture changed, so its time moved

    client = await hass_client()
    res = await client.get(f"/api/image_proxy/{entity_id}")
    assert res.status == 200 and res.content_type == "image/svg+xml"
    svg = await res.text()
    assert "Kitchen" in svg and "Any room" in svg and "Island &lt;light&gt;" in svg and "light.lamp" in svg

    # a status report alone doesn't move the picture's time
    shown = hass.states.get(entity_id).state
    watches.note_status(watch["id"], room={"id": kitchen.id, "name": "Kitchen"})
    await hass.async_block_till_done()
    assert hass.states.get(entity_id).state == shown


def test_empty_paint_map():
    assert "Nothing painted yet" in render({}, {}, str)
