# Changelog

All notable changes to the Kestrel Home Assistant component. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Licence: MIT for the whole project.
- Renamed from WristWand to Kestrel (domain `kestrel`), with brand images that Home Assistant shows for the integration. Remove the old WristWand integration, add Kestrel, and pair the watch again. The API moved to `/api/kestrel/`, events are `kestrel_fired` and `kestrel_probe`, and the label that narrows the device list is `kestrel`.

### Added

- Pairing: a watch asks to pair, Home Assistant shows a 6-digit code as a notification, and the code entered on the watch gives that watch its own access, limited to Kestrel. No Home Assistant token needs copying.
- Lets the phone find Home Assistant on the local network (port 80 or 8123, or an address typed on the watch), and tells it both the home and remote (Nabu Casa) addresses after pairing.
- The list of devices a watch can point at: lights, switches, fans, media players, locks, covers, climate, scenes, scripts, buttons and input booleans, grouped by area. Add the label `kestrel` to entities or devices to offer only those.
- Running an action from the watch: toggle, dim, play/pause, run a scene or script, press a button. Locks need a confirming tap on the watch. Repeated commands from Bluetooth retries are ignored.
- A `kestrel_fired` event for every action, with the watch and target, for automations.
- Each paired watch appears as a device; deleting the device unpairs the watch.
- Keeps each watch's painted devices, room calibrations and settings, so a reset or new watch gets them back on Sync.
- Configure (options): remove a bad paint or all of a device's paints, make a paint trigger another entity, delete a room calibration, and set the gesture thresholds, away mode and where the current room comes from.
- Away mode: while the chosen person isn't home, a watch can only trigger the entities you allow.
- Can use a sensor whose state is an area (for example from Bermuda) as the watch's current room.
- Dimming from the watch reports the light's new brightness.
- Devices offered to the watch include their area id, so the watch can list a room's devices.
- Sync sends a watch only what changed since its last sync, and the device list in a compact form.
- The device list leaves out devices' configuration and diagnostic entities (restart buttons, firmware switches and the like) and holds up to 1000 entities, up from 300; past that, the watch is told how many were left out.
- Entities on each watch's device: Last triggered (with how, where and when), Room, Last seen, Home Assistant address, Painted devices and Calibrated rooms sensors, and Gesture trigger and Away mode switches, and a Gesture select (flick, snap or tap; each keeps its own calibration). Every other setting has an entity too: Instant toggle (switch) and its delay, Room from and Away mode follows (selects), and the current gesture's thresholds (numbers, disabled by default).
- Instant toggle: trigger a device by holding the watch's aim on it (setting, off by default; 1–10 s).
- One endpoint for settings changes from the watch and the Zepp app's settings page; every field is checked.
- Security: pairing only works from the home network (not through Home Assistant Cloud or a public address), at most five pairings wait at once, watch names are plain text, a watch can only trigger the entities it's offered, and probe results have size limits. See `docs/audits.md`.
- A repair notice when watches are paired but Home Assistant has no address that works away from home.
- The `kestrel_fired` event says how the device was triggered (`via`) and from which room (`area_id`).
- Documentation: use cases, supported devices and functions, events, automation examples, known limitations, troubleshooting and removal. The device shows the watch app's version.
- Diagnostics download (tokens redacted), for the integration or for one watch from its device page. It includes the watch's recent probe results.
- Measurement results from the watch's Probes arrive as `kestrel_probe` events. The newest 500 are kept for the diagnostics download; unpairing a watch deletes its results.
