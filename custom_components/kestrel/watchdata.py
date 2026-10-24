"""What each paired watch keeps in sync with Home Assistant.

Home Assistant is the source of truth: the watch fetches everything on Sync,
and sends its own changes (new paints, room calibrations, gesture
calibration) right away. Each section has a revision number that goes up on
every change, so the watch can tell whether Home Assistant changed something
(in the integration's options) since it last synced.

  settings  gesture trigger, instant toggle, where the current room comes from
  paints    {entity_id: [spot]} where the user pointed at each device
  rooms     {area_id: {name, fingerprint: {mac: [rssi, seen]}, scans, at}}
"""

from __future__ import annotations

import copy
from typing import Any, cast

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

PAINTS_MAX_DEVICES = 300
PAINTS_MAX_SPOTS = 12  # per device: painted spots plus corrections
ROOMS_MAX = 50
FINGERPRINT_MAX_DEVICES = 200

GESTURE_KINDS = ("flick", "snap", "tap")
FLICK_DEFAULT = {"gyro": 600.0, "jolt": None}  # same as the watch's lib/gesture.js
ROOM_SOURCES = ("watch", "sensor")

DEFAULT_SETTINGS: dict[str, Any] = {
    # Gesture trigger. Each gesture keeps its own thresholds, from calibration
    # on the watch: {kind: {gyro (deg/s), jolt (accelerometer units per sample)}},
    # None = channel not used. Uncalibrated, a flick uses FLICK_DEFAULT; snaps
    # and taps need calibrating first.
    "gesture": {"enabled": True, "kind": "flick", "calibrations": {}},
    # Where the current room comes from: the watch's Bluetooth calibration, or
    # a sensor whose state is an area (for example from Bermuda).
    "room": {"source": "watch", "sensor": None},
    # Instant toggle: holding the aim on a device this many seconds triggers it.
    "dwell": {"enabled": False, "seconds": 3.0},
}
DWELL_SECONDS = (1.0, 10.0)  # allowed range, in half seconds

SECTIONS = ("settings", "paints", "rooms")


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def settings_of(watch: dict[str, Any]) -> dict[str, Any]:
    """The watch's settings with defaults filled in."""
    stored = watch.get("settings") or {}
    out = copy.deepcopy(DEFAULT_SETTINGS)
    for group, values in stored.items():
        if group in out and isinstance(values, dict):
            out[group].update({k: v for k, v in values.items() if k in out[group]})
    return out


def _threshold(value: Any) -> float | None:
    return round(float(value), 1) if is_number(value) and 0 < value < 100000 else None


def clean_thresholds(values: Any) -> dict[str, float | None] | None:
    """{gyro, jolt} checked, or None if neither is usable."""
    if not isinstance(values, dict):
        return None
    out = {key: _threshold(values.get(key)) for key in ("gyro", "jolt")}
    return out if out["gyro"] or out["jolt"] else None


def clean_gesture(values: dict[str, Any]) -> dict[str, Any]:
    """Gesture settings sent by a watch (choice, on/off, calibrations), checked."""
    out: dict[str, Any] = {}
    if isinstance(values.get("enabled"), bool):
        out["enabled"] = values["enabled"]
    if values.get("kind") in GESTURE_KINDS:
        out["kind"] = values["kind"]
    if isinstance(values.get("calibrations"), dict):
        cals = {k: clean_thresholds(v) for k, v in values["calibrations"].items() if k in GESTURE_KINDS}
        out["calibrations"] = {k: v for k, v in cals.items() if v}
    return out


def clean_settings(values: Any) -> dict[str, dict[str, Any]]:
    """A partial settings update ({group: {field: value}}), checked field by field."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(values, dict):
        return out
    if isinstance(values.get("gesture"), dict):
        out["gesture"] = clean_gesture(values["gesture"])
    if isinstance(d := values.get("dwell"), dict):
        dwell: dict[str, Any] = {}
        if isinstance(d.get("enabled"), bool):
            dwell["enabled"] = d["enabled"]
        if is_number(d.get("seconds")):
            low, high = DWELL_SECONDS
            dwell["seconds"] = round(min(max(float(d["seconds"]), low), high) * 2) / 2
        out["dwell"] = dwell
    if isinstance(r := values.get("room"), dict):
        room: dict[str, Any] = {}
        if r.get("source") in ROOM_SOURCES:
            room["source"] = r["source"]
        if "sensor" in r:
            sensor = r["sensor"]
            room["sensor"] = sensor if isinstance(sensor, str) and sensor.startswith("sensor.") else None
        out["room"] = room
    return {group: values for group, values in out.items() if values}


def thresholds(gesture: dict[str, Any]) -> dict[str, float | None] | None:
    """The chosen gesture's thresholds (as the watch uses them), or None if it needs calibrating."""
    cal = (gesture.get("calibrations") or {}).get(gesture.get("kind"))
    if cal:
        return cast(dict[str, float | None], cal)
    return dict(FLICK_DEFAULT) if gesture.get("kind") == "flick" else None


def clean_paints(paints: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Paints sent by a watch: entity ids with usable spots, capped."""
    clean: dict[str, list[dict[str, Any]]] = {}
    for target, spots in list(paints.items())[:PAINTS_MAX_DEVICES]:
        if not isinstance(target, str) or "." not in target or not isinstance(spots, list):
            continue
        kept = [s for s in spots if isinstance(s, dict) and is_number(s.get("heading")) and is_number(s.get("pitch"))]
        if kept:
            clean[target[:255]] = kept[-PAINTS_MAX_SPOTS:]
    return clean


def clean_rooms(rooms: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Room fingerprints sent by a watch, checked and capped."""
    clean: dict[str, dict[str, Any]] = {}
    for area_id, room in list(rooms.items())[:ROOMS_MAX]:
        if not isinstance(area_id, str) or not isinstance(room, dict) or not isinstance(room.get("fingerprint"), dict):
            continue
        fp = {}
        for mac, v in list(room["fingerprint"].items())[:FINGERPRINT_MAX_DEVICES]:
            if isinstance(mac, str) and isinstance(v, list) and len(v) == 2 and all(is_number(x) for x in v):
                fp[mac[:17]] = [float(v[0]), float(v[1])]
        if fp:
            clean[area_id[:64]] = {
                "name": str(room.get("name") or area_id)[:64],
                "fingerprint": fp,
                "scans": int(room["scans"]) if is_number(room.get("scans")) else 0,
                "at": room["at"] if is_number(room.get("at")) else 0,
            }
    return clean


def areas(hass: HomeAssistant) -> list[dict[str, str]]:
    """All Home Assistant areas, by name."""
    out = [{"id": a.id, "name": a.name} for a in ar.async_get(hass).async_list_areas()]
    out.sort(key=lambda a: a["name"].lower())
    return out


def area_of_state(hass: HomeAssistant, value: str | None) -> dict[str, str] | None:
    """The area a sensor's state names (by name or id), or None."""
    if not value:
        return None
    wanted = value.strip().lower()
    for a in ar.async_get(hass).async_list_areas():
        if wanted in (a.id.lower(), a.name.lower()):
            return {"id": a.id, "name": a.name}
    return None


def current_room(hass: HomeAssistant, settings: dict[str, Any]) -> dict[str, str] | None:
    """The room from the configured sensor, when the room source is a sensor."""
    room = settings["room"]
    if room["source"] != "sensor" or not room["sensor"]:
        return None
    state = hass.states.get(room["sensor"])
    return area_of_state(hass, state.state if state else None)
