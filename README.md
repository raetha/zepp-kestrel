# WristWand

Point your Amazfit watch at a smart-home device and trigger it. An open-source pointing remote for Zepp OS watches, built around [Home Assistant](https://www.home-assistant.io/).

> **Status: M1, first working version.** Pair the watch with Home Assistant, paint a device, point at it and press the select button to toggle it. The M0 probes (sensor rates, gestures, compass, Bluetooth, latency) are still on the watch under Probes. There is no release yet.

<p align="center">
  <img src="watch/docs/screenshot-menu.png" width="240" alt="WristWand probe menu on the watch">
</p>

## How it will work

1. **Paint** each device once: sweep your arm across it for about 15 seconds.
2. **Point** at it. The watch shows what it thinks you mean.
3. **Trigger**: snap, flick, press a button or tap. A twist dims lights. Locks always ask for a confirming tap.

It works best with the WristWand Home Assistant component: the watch pairs with a code instead of a copied token, lists your devices by area, keeps working away from home through Nabu Casa, and every action fires a `wristwand_fired` event for automations. Store installs will also be able to use Home Assistant without it (a URL and a long-lived token in the app's settings). See [docs/design.md](docs/design.md).

## Try the test build

Test builds are for development and change often.

**1. Install the Home Assistant component.** In HACS: ⋮ → Custom repositories → `https://github.com/raetha/zepp-wristwand`, type Integration, then open WristWand. There's no release yet, so first turn on its test builds: ⋮ → Redownload → switch on **Show beta versions** → pick the newest `ha-v…-dev.N` → Download, then restart Home Assistant. (Each push to `dev` publishes a new one; HACS offers it as an update.) Or copy `custom_components/wristwand` from the `dev` branch into your HA config folder. Then Settings → Devices & services → Add integration → WristWand.

**2. Install the watch app.**
1. In the Zepp app, turn on Developer Mode: Profile → Settings → About, tap the Zepp logo 7 times.
2. Open the [test-build page](https://raetha.github.io/zepp-wristwand/dev/) on another screen.
3. In the Zepp app: Profile → your watch → Developer Mode → scan icon (top right). Scan the top code and confirm.

**3. Pair.** With your phone on the home Wi-Fi, open WristWand DEV on the watch → Pair with HA. Pick your Home Assistant, then type the 6-digit code from the notification Home Assistant shows. The watch then fetches your devices. (If the Zepp app asks for Local Network access, allow it: that's how the phone finds `homeassistant.local`.)

**4. Paint and point.** Paint a device: pick it, stand where you'd use it, press Start, and sweep your arm slowly across it for 15 s. Then Point: hold your arm out at it. The circle turns green when the watch has it in mind; press the select button (or tap the circle) to toggle it. Locks ask for a confirming tap.

To offer the watch only some devices, add the label `wristwand` to those entities or devices in Home Assistant, then Sync on the watch. Each paired watch appears in Home Assistant as a device under the WristWand integration; delete the device to unpair it.

If your phone can't find Home Assistant (another port, or a name other than `homeassistant.local`), choose **Type address** on the watch and enter its IP address, with `:port` if it isn't 80 or 8123.

### Running the M0 probes

Under **Probes** on the watch. Results show on the watch, and once the watch is paired each result (raw sensor traces included) also arrives in Home Assistant as a `wristwand_probe` event: open Developer tools → Events, enter `wristwand_probe` under "Listen to events", press **Start listening**, then run the probes and copy what arrives. The select button presses the main button on every probe screen.

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

- **The watch app** (`watch/`): [CC BY-NC-SA 4.0](LICENSES/CC-BY-NC-SA-4.0.txt). Share and remix it non-commercially with credit, but don't sell it or its derivatives.
- **The Home Assistant component** (when it arrives), **generic helpers** (`lib/`) **and tooling** (`tools/`, CI): [MIT](LICENSES/MIT.txt).
- **The name "WristWand"** and its icon aren't licensed for reuse.

Details are in [LICENSE](LICENSE). WristWand is an independent project and is not affiliated with Zepp Health, Amazfit or Home Assistant.
