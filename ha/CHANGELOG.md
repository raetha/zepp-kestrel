# Changelog

All notable changes to the Kestrel Home Assistant component. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

The first release of the Kestrel integration: the Home Assistant side of the Kestrel
watch app, which lets you point an Amazfit watch at a device and trigger it.

### Added

- **Pairing:** a watch asks to pair, Home Assistant shows a 6-digit code as a notification, and the code entered on the watch gives that watch its own key, limited to Kestrel. A watch paired again is recognised (by a hash of its unique id) and gets its setup back; a new watch can take over an earlier one's setup, or that of a watch removed in the last 30 days.
- **Devices for watches:** Configure chooses which devices or entities watches can use (nothing chosen: everything). Lights, switches, fans, media players, locks, covers, climate, scenes, scripts, buttons, input booleans and input buttons, grouped by area.
- **Actions from the watch:** toggle, dim, media volume, play/pause, run a scene or script, press a button. Locks need a confirming tap; a watch can only ask for actions that fit the device; repeated commands from Bluetooth retries are ignored. Media volume has limits per watch (per twist, and a maximum).
- **A `kestrel_fired` event** for every action, with the watch, target, how it was triggered and from which room, for automations.
- **One device per watch** with sensors (last triggered, room, last seen, address, painted devices, calibrated rooms, phone app version), switches (gesture trigger, instant toggle, open on Point, learn from use, detailed diagnostics), selects (gesture, room source), numbers (screen time, instant toggle delay, volume limits, gesture thresholds) and a paint map image. Deleting the device unpairs the watch.
- **Each watch's paints, rooms and settings are kept here** and synced to the watch, sending only what changed. Configure edits them: remove a bad paint, point a paint at another entity, delete a room calibration, and every setting.
- **Rooms** from the watch's Bluetooth calibration, or from a sensor whose state is an area (for example Bermuda).
- **Repairs:** a watch not heard from in 30 days gets a notice offering to remove it, so an old or duplicate watch doesn't keep a working key.
- **Diagnostics** for the integration or one watch, safe to attach to a public issue: tokens, hardware ids and network addresses removed, Bluetooth addresses replaced by codes. Detailed diagnostics (a switch per watch, off again after a week) adds aim traces and room scans for tuning; results are kept for 14 days.
- **Security:** Kestrel works only from your home network (never through Home Assistant Cloud or a public address), each watch has its own key, a watch can only trigger the devices it's offered, and every value from a watch is checked. See `docs/audits.md`.
