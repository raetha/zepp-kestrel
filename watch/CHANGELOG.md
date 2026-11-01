# Changelog

All notable changes to the Kestrel watch app. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

The first release of Kestrel: point your Amazfit watch at a smart-home device and
trigger it, through Home Assistant. It needs the Kestrel Home Assistant integration
(released alongside it) and works on your home network, or a VPN into it.

### Added

- **Pairing:** the phone finds Home Assistant on your home Wi-Fi (`homeassistant.local`, or an address typed on the watch), Home Assistant shows a 6-digit code, and you type it on the watch. No tokens to copy. The same watch paired again gets its setup back, and a new watch can take over an earlier one's paints, rooms and settings.
- **Paint:** pick a device (starting with the room you're in), then sweep your arm across it for 15 seconds. Paint it again from other places you use it from. Paint warns when two devices sit too close to tell apart, and asks you to calibrate the compass when it needs it. Scenes, scripts and buttons can be painted on any spot you like.
- **Point:** hold your arm out at a painted device. The screen turns amber while aiming, dark green when the watch has a device in mind and bright green when it's locked on; press the button or tap the screen to toggle it. Locks ask for a confirming tap. "Not it?" offers the next most likely device for 5 seconds after a trigger.
- **Gestures and instant toggle:** trigger with a wrist flick, finger snap or finger tap (each calibrated to you), or just by holding the aim on a device for a few seconds.
- **Dimming and volume:** on a dimmable light or a media player, roll your wrist once it's locked; Home Assistant keeps media volume within limits you set.
- **Rooms:** calibrate each Home Assistant area by Bluetooth (or use a room sensor such as Bermuda), and Point only picks devices in the room you're in.
- **Learning from use:** clear triggers you didn't correct slowly refine where each device is.
- **Home Assistant holds your setup:** paints, rooms and settings are kept there and synced, so a reset or a new watch gets them back. Settings can be changed on the watch, in Home Assistant, or on the Zepp app's settings page.
- **Screen and battery:** Kestrel's screens stay on 30 s without a touch (adjustable), Point keeps the screen on only while your arm is held out, and Point can reopen when you raise your wrist. Open on Point makes Kestrel's shortcut go straight to pointing.
- **Diagnostics for tuning:** with Detailed diagnostics on in Home Assistant (it turns itself off after a week), the watch sends aim traces and room scans to your own Home Assistant to help improve pointing. Nothing extra is measured or sent with it off.
- **Probes:** measurements of the watch's sensors, gestures, compass, Bluetooth and latency, for checking a new watch model.
- Supported watches: Zepp OS 4 watches with a compass, round and square (the README lists the models). Watches still on Zepp OS 3.x firmware crash running the app and aren't supported.
