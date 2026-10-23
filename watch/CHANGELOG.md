# Changelog

All notable changes to the WristWand watch app. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- M0 measurement build: probes for sensor rates, snap/tap/flick recordings, compass tilt, Bluetooth scans per room, and watch → phone → Home Assistant latency.
- Settings page in the Zepp app for the Home Assistant URL and token, with a connection test, a list of probe results, and an option to send results to Home Assistant as `wristwand_probe` events.
- Pairing with Home Assistant (needs the WristWand integration): the phone finds Home Assistant on the home Wi-Fi (`homeassistant.local` on port 80 or 8123; other addresses can be typed on the watch), Home Assistant shows a 6-digit code, and you type it on the watch. Afterwards it also works away from home through your Home Assistant's remote address (for example Nabu Casa).
- Paint a device: pick it from the synced list, then sweep your arm across it for 15 seconds. Painting again from other places you use it improves aim. Unsteady compass readings are rejected with a hint.
- Point: hold your arm out at a painted device; the circle turns amber while aiming, green when the watch has a device in mind, and bright green when it's sure. Press the select button or tap the circle to toggle it. Locks ask for a confirming tap. Short buzzes confirm sent, done and failed.
- Home screen with Point, Paint, Sync, Probes and Unpair. The M0 probes moved under Probes.
- Probes report on screen whether each result reached Home Assistant.
- Licence: CC BY-NC-SA 4.0 for the watch app (share and adapt non-commercially, with credit, but don't sell it).

### Changed

- Aim uses where your forearm points (the watch's compass heading turned by 90°), and works with the wrist turned up to about 80°. Devices painted with earlier test builds need painting again.
- Compass tilt probe: two short guided recordings (up and down along one line; wrist turned in and out) instead of single captures. Each step is announced by 1 to 4 buzzes, so you needn't read the screen, and all steps are shown before you start.
- Sensor rates probe also measures the compass in each speed mode.
- Point and Paint read the compass at its normal speed, which gives the most fresh headings.
- Probe screens and Paint keep the screen on only while a probe runs or a device is being painted; otherwise the watch times out as usual.

### Added (testing)

- The app records which screens it opened, which buttons and swipes arrived, and any errors, and sends that to Home Assistant at the next launch (in the diagnostics download), to track down why the lower button or a swipe sometimes closes the app instead of going back. Errors in a screen are contained instead of closing the app.

### Fixed

- Probe results stopped reaching Home Assistant ("Not sent: undefined is not an object"): the phone now sends each result to Home Assistant before keeping a small summary for itself, clears an oversized summary list, and says which step failed if one does.
