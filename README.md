# WristWand

Point your Amazfit watch at a smart-home device and trigger it. An open-source pointing remote for Zepp OS watches, built around [Home Assistant](https://www.home-assistant.io/).

> **Status: M0, measurement build.** The watch app is currently a set of probes that measure what the hardware can do (sensor rates, gesture recordings, compass behaviour, Bluetooth per room, latency), so the real app is built on numbers rather than guesses. There is no release yet.

<p align="center">
  <img src="watch/docs/screenshot-menu.png" width="240" alt="WristWand probe menu on the watch">
</p>

## How it will work

1. **Paint** each device once: sweep your arm across it for about 15 seconds.
2. **Point** at it. The watch shows what it thinks you mean.
3. **Trigger**: snap, flick, press a button or tap. A twist dims lights. Locks always ask for a confirming tap.

It works with Home Assistant as it is (a URL and a long-lived token), and does more with the optional WristWand Home Assistant component: paint scripts or virtual targets, choose each target's action in HA, use events in automations, and back up your painted devices in HA. See [docs/design.md](docs/design.md).

## Try the test build

Test builds are for development and change often.

1. In the Zepp app, turn on Developer Mode: Profile → Settings → About, tap the Zepp logo 7 times.
2. Open the [test-build page](https://raetha.github.io/zepp-wristwand/dev/) on another screen.
3. In the Zepp app: Profile → your watch → Developer Mode → scan icon (top right). Scan the code and confirm.
4. In the Zepp app, open **WristWand DEV**'s settings: enter your Home Assistant URL and a long-lived access token (HA → Profile → Security), then **Test connection**.

### Running the M0 probes

Optionally turn on **Send probe results to HA** in the settings: each result, including raw sensor traces, then arrives in Home Assistant as a `wristwand_probe` event (Developer tools → Events → listen to `wristwand_probe`). Results also show on the watch and in the settings page. The select button presses the main button on every probe screen.

| Probe | What to do | What it answers |
| --- | --- | --- |
| Sensor rates | Start, then keep the watch moving gently for 35 s | Real rates of the accelerometer and gyro in each mode, and the compass |
| Snap recorder | Arm out, pick a gesture, Record, gesture after the buzz. About 10 each of snap, finger tap, wrist flick, arm wave, nothing | Whether a snap leaves a spike that stands apart from other movement |
| Compass tilt | Point at one fixed spot; Capture in each pose | Whether the heading holds as the wrist rotates, and how noisy it is indoors |
| BLE scan | In each room, pick a label and Scan | How many steady Bluetooth devices each room has |
| Latency | Run, with HA set up | Watch ↔ phone and phone ↔ HA round trips (target: under 500 ms) |

## Development

See [docs/development.md](docs/development.md): layout, emulator, branches, test builds and releases.

```bash
npm install && npm test
cd watch && zeus build
```

## Support

If you find this useful, you can [sponsor the project](https://github.com/sponsors/raetha).

## License

- **The WristWand app** (`watch/`, and the Home Assistant component when it arrives): [CC BY-NC-SA 4.0](LICENSES/CC-BY-NC-SA-4.0.txt). Share and remix it non-commercially with credit, but don't sell it or its derivatives.
- **Shared helper code and tooling** (`watch/lib/`, `tools/`, CI): [MIT](LICENSES/MIT.txt).
- **The name "WristWand"** and its icon aren't licensed for reuse.

Details are in [LICENSE](LICENSE). WristWand is an independent project and is not affiliated with Zepp Health, Amazfit or Home Assistant.
