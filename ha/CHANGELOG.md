# Changelog

All notable changes to the WristWand Home Assistant component. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Pairing: a watch asks to pair, Home Assistant shows a 6-digit code as a notification, and the code entered on the watch gives that watch its own access, limited to WristWand. No Home Assistant token needs copying.
- Lets the phone find Home Assistant on the local network (port 80 or 8123, or an address typed on the watch), and tells it both the home and remote (Nabu Casa) addresses after pairing.
- The list of devices a watch can point at: lights, switches, fans, media players, locks, covers, climate, scenes, scripts, buttons and input booleans, grouped by area. Add the label `wristwand` to entities or devices to offer only those.
- Running an action from the watch: toggle, dim, play/pause, run a scene or script, press a button. Locks need a confirming tap on the watch. Repeated commands from Bluetooth retries are ignored.
- A `wristwand_fired` event for every action, with the watch and target, for automations.
- Each paired watch appears as a device; deleting the device unpairs the watch.
- Keeps each watch's painted devices, room calibrations and settings, so a reset or new watch gets them back on Sync.
- Configure (options): remove a bad paint or all of a device's paints, make a paint trigger another entity, delete a room calibration, and set the gesture thresholds, away mode and where the current room comes from.
- Away mode: while the chosen person isn't home, a watch can only trigger the entities you allow.
- Can use a sensor whose state is an area (for example from Bermuda) as the watch's current room.
- Dimming from the watch reports the light's new brightness.
- Devices offered to the watch include their area id, so the watch can list a room's devices.
- Sync sends a watch only what changed since its last sync, and the device list in a compact form.
- The device list leaves out devices' configuration and diagnostic entities (restart buttons, firmware switches and the like) and holds up to 1000 entities, up from 300; past that, the watch is told how many were left out.
- Entities on each watch's device: Last triggered (with how, where and when), Room, Last seen, Home Assistant address, Painted devices and Calibrated rooms sensors, and Gesture trigger and Away mode switches. The device shows the watch app's version.
- Diagnostics download (tokens redacted), for the integration or for one watch from its device page. It includes the watch's recent probe results.
- Measurement results from the watch's Probes arrive as `wristwand_probe` events. The newest 500 are kept for the diagnostics download; unpairing a watch deletes its results.
