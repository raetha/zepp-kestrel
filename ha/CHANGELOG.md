# Changelog

All notable changes to the WristWand Home Assistant component. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Pairing: a watch asks to pair, Home Assistant shows a 6-digit code as a notification, and the code entered on the watch gives that watch its own access, limited to WristWand. No Home Assistant token needs copying.
- Lets the phone find Home Assistant on the local network, and tells it both the home and remote (Nabu Casa) addresses after pairing.
- The list of devices a watch can point at: lights, switches, fans, media players, locks, covers, climate, scenes, scripts, buttons and input booleans, grouped by area. Add the label `wristwand` to entities or devices to offer only those.
- Running an action from the watch: toggle, dim, play/pause, run a scene or script, press a button. Locks need a confirming tap on the watch. Repeated commands from Bluetooth retries are ignored.
- A `wristwand_fired` event for every action, with the watch and target, for automations.
- Removing paired watches from the integration's options.
- Measurement results from the watch's Probes arrive as `wristwand_probe` events.
