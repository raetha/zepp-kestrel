# Changelog

All notable changes to the Kestrel watch app. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- M0 measurement build: probes for sensor rates, snap/tap/flick recordings, compass tilt, Bluetooth scans per room, and watch → phone → Home Assistant latency.
- Settings page in the Zepp app for the Home Assistant URL and token, with a connection test, a list of probe results, and an option to send results to Home Assistant as `kestrel_probe` events.
- Pairing with Home Assistant (needs the Kestrel integration): the phone finds Home Assistant on the home Wi-Fi (`homeassistant.local` on port 80 or 8123; other addresses can be typed on the watch), Home Assistant shows a 6-digit code, and you type it on the watch. Afterwards it also works away from home through your Home Assistant's remote address (for example Nabu Casa).
- Paint a device: pick it from the synced list, then sweep your arm across it for 15 seconds. Painting again from other places you use it improves aim. Unsteady compass readings are rejected with a hint.
- Point: hold your arm out at a painted device; the circle turns amber while aiming, green when the watch has a device in mind, and bright green when it's sure. Press the select button or tap the circle to toggle it. Locks ask for a confirming tap. Short buzzes confirm sent, done and failed.
- Home screen with Point, Paint, Sync, Probes and Unpair. The M0 probes moved under Probes.
- Probes report on screen whether each result reached Home Assistant.
- Gesture trigger: on Point, aim, then flick your wrist, snap or tap your fingers. More → Gesture picks the gesture and calibrates it to yours (five gestures and a few seconds of aiming), or turns it off.
- Dimming: on a dimmable light, hold the select button or the circle and twist your wrist; thumb up brightens.
- Rooms: More → Rooms calibrates each Home Assistant area by Bluetooth. Pointing then only considers devices painted in the room you're in. A Home Assistant room sensor (for example Bermuda) can be used instead.
- Home Assistant holds the master copy of paints, rooms and settings: changes made in the integration's options (removing a bad paint, pointing a paint at another entity) reach the watch on Sync, and the app syncs quietly when it starts.
- The BLE probe lists your Home Assistant areas.
- Paint starts with the devices of the room you're in (from your room calibration or a Home Assistant sensor), or asks which room first, so you don't page through every device. The Room button switches rooms; All devices and No area are there too.
- The home screen shows the build number, and Sync shows how many areas came from Home Assistant.
- The app syncs with Home Assistant each time it starts, fetching only what changed (usually almost nothing); Sync fetches everything. The device list is sent more compactly.
- Larger, brighter text throughout, for reading at arm's length and in night mode.
- More shows the Home Assistant address the phone is using.
- Leaving a screen while it was still waiting for the phone could leave the app stuck (Home on "Checking…", every request hanging) until it was closed. Requests now always finish, and a stalled connection to the phone is retried.
- Instant toggle: hold the aim on a device for a few seconds to trigger it, with no button or gesture (More → Instant, or in Home Assistant). It fires once per hold; locks still need a press.
- The Zepp app's settings page (store installs) shows and changes the watch's settings: gesture, instant toggle, away mode and room source. Changes go to Home Assistant and reach the watch when it next syncs.
- A snap or tap no longer triggers twice: gestures are ignored for 3 seconds after a trigger and while the watch itself buzzes (its vibration looked like another snap).
- Each gesture (flick, snap, tap) keeps its own calibration, so switching between them, on the watch or from Home Assistant, needs no recalibrating. Point says when the chosen gesture still needs calibrating.
- Point keeps the screen on while you're pointing: every time your arm is held out, or something is triggered, the screen gets another 30 seconds. Lowering your wrist lets it go off as usual.
- When the compass needs calibrating, Paint asks you to turn the watch in a circle (as the Compass app does) and waits, instead of recording a sweep that fails; Point says the same.
- Tells Home Assistant its version, the room it placed itself in, and how each trigger happened, for the watch's sensors there.
- When Home Assistant has more devices than it sends, Sync says so ("1000 of 1240 devices"); the `kestrel` label narrows the list.
- Pairing again keeps the watch's paints and room calibrations and sends them to Home Assistant.
- One QR code on the test-build page; it never expires.
- Corrections: after a trigger, "Not it?" offers the next most likely device for 5 seconds. Choosing it undoes the first where possible, toggles the right one, and teaches the watch where you aimed.
- Each trigger sends a short record of the aim to Home Assistant (in the diagnostics download), to tune pointing.
- More screen on Home: Gesture, Rooms, Probes and Unpair.
- Licence: CC BY-NC-SA 4.0 for the watch app (share and adapt non-commercially, with credit, but don't sell it).

### Changed

- Renamed from WristWand to Kestrel, with a new icon. Test builds install as "Kestrel DEV" and need pairing again with the renamed Home Assistant integration. Uninstall WristWand DEV first: nothing it stored carries over.
- Aim uses where your forearm points (the watch's compass heading turned by 90°). Keep the palm roughly down: with the wrist turned more than about 45° the compass drifts, so aim waits until it has settled. Devices painted with earlier test builds need painting again.
- Point reopens when you raise your wrist again after the screen went off, instead of the watch returning to the watch face.
- Compass tilt probe: two short guided recordings (up and down along one line; wrist turned in and out) instead of single captures. Each step is announced by 1 to 4 buzzes, so you needn't read the screen, and all steps are shown before you start.
- Sensor rates probe also measures the compass in each speed mode.
- Point and Paint read the compass at its normal speed, which gives the most fresh headings.
- Probe screens and Paint keep the screen on only while a probe runs or a device is being painted; otherwise the watch times out as usual.

### Added (testing)

- The app records which screens it opened, which buttons and swipes arrived, and any errors, and sends that to Home Assistant at the next launch (in the diagnostics download), to track down why the lower button or a swipe sometimes closes the app instead of going back. Errors in a screen are contained instead of closing the app.

### Fixed

- The record of screens, buttons and swipes kept only launches and exits: the app itself overwrote what the screens wrote when it closed. Launches are now noted by the home screen, and the record also says which watch model it is.
- The Compass tilt probe says when the compass needs calibrating instead of recording without headings.
- Probe results stopped reaching Home Assistant ("Not sent: undefined is not an object"): the phone now sends each result to Home Assistant before keeping a small summary for itself, clears an oversized summary list, and says which step failed if one does.
