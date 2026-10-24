<p align="center"><img src="brand/kestrel.svg" width="128" alt="Kestrel logo: a kestrel diving at a target"></p>

# Kestrel

Point your Amazfit watch at a smart-home device and trigger it. Hold your arm still on the lamp across the room, the way a kestrel hangs still in the wind over its target, then flick your wrist and the light comes on. An open-source pointing remote for Zepp OS watches, built around [Home Assistant](https://www.home-assistant.io/).

> **Status: feature-complete test builds, before release polish.** Pair the watch with Home Assistant, paint devices, point, and trigger with the select button, a tap or a gesture (wrist flick, finger snap or finger tap). Twist to dim lights. Rooms are recognised by Bluetooth (or a Home Assistant sensor). Away mode, paints, rooms and settings are managed in Home Assistant. There is no release yet.

<p align="center">
  <img src="watch/docs/screenshot-menu.png" width="240" alt="Kestrel probe menu on the watch">
</p>

## How it will work

1. **Paint** each device once: sweep your arm across it for about 15 seconds.
2. **Point** at it. The watch shows what it thinks you mean.
3. **Trigger**: snap, flick, press a button or tap. A twist dims lights. Locks always ask for a confirming tap.

It works best with the Kestrel Home Assistant component: the watch pairs with a code instead of a copied token, lists your devices by area, keeps working away from home through Nabu Casa, and every action fires a `kestrel_fired` event for automations. Store installs will also be able to use Home Assistant without it (a URL and a long-lived token in the app's settings). See [docs/design.md](docs/design.md).

## Try the test build

Test builds are for development and change often.

**1. Install the Home Assistant component.** In HACS: ⋮ → Custom repositories → `https://github.com/raetha/zepp-kestrel`, type Integration, then open Kestrel. There's no release yet, so first turn on its test builds: ⋮ → Redownload → switch on **Show beta versions** → pick the newest `ha-v…-dev.N` → Download, then restart Home Assistant. (Each push to `dev` publishes a new one; HACS offers it as an update.) Or copy `custom_components/kestrel` from the `dev` branch into your HA config folder. Then Settings → Devices & services → Add integration → Kestrel.

**2. Install the watch app.**
1. In the Zepp app, turn on Developer Mode: Profile → Settings → About, tap the Zepp logo 7 times.
2. Open the [test-build page](https://raetha.github.io/zepp-kestrel/dev/) on another screen.
3. In the Zepp app: Profile → your watch → Developer Mode → scan icon (top right). Scan the QR code and confirm. It never changes and always installs the newest build; the home screen shows the build number at the bottom.

**3. Pair.** With your phone on the home Wi-Fi, open Kestrel DEV on the watch → Pair with HA. Pick your Home Assistant, then type the 6-digit code from the notification Home Assistant shows. The watch then fetches your devices. (If the Zepp app asks for Local Network access, allow it: that's how the phone finds `homeassistant.local`.)

**4. Paint and point.** Paint a device: pick it, stand where you'd use it, press Start, and sweep your arm slowly across it for 15 s, palm down. Then Point: hold your arm out at it, palm down. The circle turns green when the watch has it in mind; press the select button, tap the circle, or do your gesture to toggle it. Locks ask for a confirming tap. If the watch picked the wrong device, tap **Not it?** within 5 s: it undoes the first (lights, switches, fans and the like), toggles the right one, and remembers where you aimed. Dropping your wrist and raising it again brings Point back.

To test without your own devices nearby (at work, say), create a helper in Home Assistant (Settings → Devices & services → Helpers → Toggle), Sync, and paint something in the room, like a door frame, as that helper.

**5. Dim.** On a dimmable light, hold the select button (or a finger on the circle) and twist your wrist: thumb up brightens, thumb down dims, a quarter turn is the whole range. Let go to send it.

**6. Gesture.** More → Gesture: choose wrist flick, finger snap or finger tap, then Calibrate: five gestures after the buzzes, then a few seconds of slowly pointing around. The watch learns thresholds that separate your gesture from aiming, and keeps them per gesture, so you can switch later (on the watch or with the Gesture select in Home Assistant) without calibrating again. It only counts while you're aiming at something, and only once: gestures are ignored for 3 seconds after a trigger.

**7. Instant toggle.** More → Instant: Off, 2 s, 3 s or 5 s (any delay from 1 to 10 s in Home Assistant). With it on, holding the aim locked on a device that long triggers it, no button or gesture needed; the circle counts down. It fires once per hold: look away and back to trigger the same device again. Locks still need a press.

**8. Rooms.** More → Rooms lists your Home Assistant areas. Calibrate each room you point in: walk around it for three short Bluetooth scans. Paint devices afterwards, from inside each room: then the watch only considers devices painted in the room you're in, which keeps things apart that line up through walls. "Where am I?" tests it. If you already track rooms in Home Assistant (for example Bermuda), choose that sensor in the integration's options instead.

**Managing things in Home Assistant.** Settings → Devices & services → Kestrel → Configure:
- **Painted devices**: remove a bad paint (the newest spot) or all of a device's paints, or make a paint trigger a different entity.
- **Rooms**: delete a room's calibration.
- **Settings**: gesture on or off, which gesture and its thresholds; instant toggle and its delay; **away mode** (while the chosen person isn't home, only the entities you allow work, so pointing at work doesn't switch things at home); where the current room comes from.

The watch picks changes up on its next Sync (it also syncs quietly each time the app starts). Paints, rooms and settings live in Home Assistant, so a reset or new watch gets them back on Sync.

The watch is offered every supported entity except hidden, disabled, and devices' configuration or diagnostic entities, up to 1000 (Sync shows "1000 of N devices" when some are left out). To offer only some devices, add the label `kestrel` to those entities or devices in Home Assistant, then Sync on the watch. Each paired watch appears in Home Assistant as a device under the Kestrel integration; delete the device to unpair it.

**On each watch's device page** in Home Assistant:

| Entity | What it shows |
| --- | --- |
| Last triggered | The device the watch last triggered; attributes say how (button, tap, flick, snap, dim), from which room and when. Handy for automations along with the `kestrel_fired` event. |
| Room | The room the watch last placed itself in (only updated while Kestrel is open). |
| Gesture trigger (switch) | Turns the flick/snap/tap trigger on or off, for example from an automation while you work out. |
| Gesture (select) | Which gesture triggers: wrist flick, finger snap or finger tap. Each keeps its own calibration, so switching is instant; a snap or tap that was never calibrated asks for calibration on the watch. |
| Instant toggle (switch), Instant toggle delay (number) | Trigger by holding the aim on a device, and for how long (1–10 s). |
| Gesture gyro threshold, Gesture jolt threshold (numbers, disabled by default) | The current gesture's calibrated thresholds, to nudge if it triggers too easily (raise) or too hard (lower). |
| Away mode (switch), Away mode follows (select) | Away mode on or off, and whose presence it follows. The entities allowed while away are chosen under Configure. |
| Room from (select) | The watch's own Bluetooth room calibration, or a Home Assistant sensor (chosen under Configure). |
| Last seen, Home Assistant address, Painted devices, Calibrated rooms | Diagnostics: when the watch last talked to Home Assistant, the address it used, and what it has set up. |

The device's software version is the watch app's build. Changes reach the watch on its next sync. Every setting is also under Configure; lists of entities (allowed while away, the room sensor) only there.

**In the Zepp app** (store installs: sideloaded test builds get no settings page), the app's settings page shows the same settings (gesture, instant toggle, away mode, room source) and changes them in Home Assistant.

If your phone can't find Home Assistant (another port, or a name other than `homeassistant.local`), choose **Type address** on the watch and enter its IP address, with `:port` if it isn't 80 or 8123.

### Running the M0 probes

Under **More → Probes** on the watch. Results show on the watch, and once the watch is paired each one (raw sensor traces included) also goes to Home Assistant; the probe screen says whether it got there. To hand results over, download them in one file: Settings → Devices & services → Kestrel → your watch's device → ⋮ → **Download diagnostics**. Home Assistant keeps the newest 500 results. Each also fires a `kestrel_probe` event, for watching live in Developer tools → Events. The select button presses the main button on every probe screen; back returns to the list.

| Probe | What to do | What it answers |
| --- | --- | --- |
| Sensor rates | Start, then keep the watch moving gently for 45 s | Real rates of the accelerometer and gyro in each mode, and the compass |
| Snap recorder | Arm out, pick a gesture, Record, gesture after the buzz. About 10 each of snap, finger tap, wrist flick, arm wave, nothing | Whether a snap leaves a spike that stands apart from other movement |
| Compass tilt | **Up and down**: point along one vertical line (a door frame or wall edge), following the buzzes: level, higher, lower, level. **Wrist roll**: point at one spot, turn the wrist in, then out. 12 s each | Whether the compass heading holds as the arm tilts and the wrist turns |
| BLE scan | In each room, pick a label and Scan | How many steady Bluetooth devices each room has |
| Latency | Run, with HA set up | Watch ↔ phone and phone ↔ HA round trips (target: under 500 ms) |

## The Home Assistant integration

### Use cases

- Point at a lamp across the room and flick your wrist (or just hold the aim, with instant toggle) to switch it, without a phone or a wall switch.
- Twist your wrist to dim a light you're pointing at.
- Trigger scenes or scripts by pointing at a spot: paint a corner of the room as a "movie time" script.
- Build automations on what you point at: the `kestrel_fired` event and the Last triggered sensor say what was triggered, how and where.

### Supported devices

Zepp OS watches with a compass, an accelerometer and a gyroscope, on Zepp OS 3.6 (API level 3.6) or later, with the Zepp app on a phone. Developed on the Amazfit Balance 3 (480 × 480, round) and checked on the Zepp OS emulator (Balance 2 firmware). Other round watches should work; layouts are designed at 480 px wide and scale. The watch can trigger lights, switches, fans, media players, locks, covers, climate entities, scenes, scripts, buttons and input booleans.

### Supported functions

- **Pairing**: a code shown in Home Assistant, typed on the watch; each watch gets its own token, limited to Kestrel's API.
- **Triggering**: toggle (or the domain's natural action: press a button, run a scene or script, play/pause media); locks always ask for a confirming tap; dimming with a wrist twist.
- **Entities per watch**: see the table above (sensors, switches, selects, numbers).
- **Configure**: paints (remove, reassign), room calibrations, and every setting.
- **Diagnostics**: per integration and per watch, with recent probe results; tokens redacted.

### Events (triggers)

`kestrel_fired` fires for every action a watch runs:

| Field | Meaning |
| --- | --- |
| `watch_id`, `watch_name` | Which watch |
| `target` | The entity triggered |
| `action` | `toggle` or `dim` |
| `via` | `button`, `tap`, `flick`, `snap`, `dim` or `dwell` (instant toggle) |
| `area_id` | The room the watch was in, if known |

`kestrel_probe` carries measurement results from the watch's Probes screen (for development).

### Automation examples

Announce what was pointed at, for testing:

```yaml
triggers:
  - trigger: event
    event_type: kestrel_fired
actions:
  - action: persistent_notification.create
    data:
      message: "{{ trigger.event.data.watch_name }} → {{ trigger.event.data.target }} ({{ trigger.event.data.via }})"
```

Turn the gesture trigger off during a workout (here with a Zepp2Hass workout sensor; use your own):

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.amazfit_workout_active
actions:
  - action: "switch.turn_{{ 'off' if trigger.to_state.state == 'on' else 'on' }}"
    target:
      entity_id: switch.amazfit_watch_gesture_trigger
```

### How data updates

Nothing is polled. The watch talks to Home Assistant when it opens (a quick sync of what changed), when you trigger something, and when you change something on it; entities update from those requests. Changes made in Home Assistant reach the watch on its next sync (every time the app opens, or Sync).

### Known limitations

- Pointing relies on the watch's compass: it must be calibrated (the watch says when it isn't), and metal nearby bends it. Paint each device from where you use it; repeatable distortion is fine.
- The watch only works while Kestrel is open on it: Zepp OS doesn't let apps run in the background.
- Sideloaded test builds get no settings page in the Zepp app (only store installs do); settings are in Home Assistant and on the watch.
- Without an address that works away from home (Home Assistant Cloud or an external URL), watches only work on the home network. Home Assistant shows a repair notice when that's the case.
- Up to 1000 entities are offered to a watch; the `kestrel` label narrows the list.
- Finger snaps and taps move the watch little, so they may not calibrate well; a wrist flick is the most reliable gesture.

### Troubleshooting

- **"Phone not reachable"**: the Zepp app must be running on the phone (in the background is fine) and connected to the watch over Bluetooth.
- **"Pair from your home network"**: pairing only works on your home network (for safety, not through Home Assistant Cloud or from outside). Pair at home; afterwards the watch works away from home too.
- **Pairing can't find Home Assistant**: your phone must be on the home Wi-Fi, with the Kestrel integration added. Choose Type address on the watch and enter Home Assistant's IP (and port, if not 80 or 8123). More shows the address in use once paired.
- **Nothing locks on when pointing**: calibrate the compass (the Compass app, or turn the watch in a circle when asked), then paint again from where you stand.
- **Wrong device triggers**: use "Not it?" right after to correct it, or paint again from that spot.
- **Something else**: Settings → Devices & services → Kestrel → your watch → ⋮ → Download diagnostics, and attach it to an issue.

### Removing Kestrel

1. On the watch: More → Unpair (or just delete the watch's device in Home Assistant, which unpairs it).
2. In Home Assistant: Settings → Devices & services → Kestrel → ⋮ → Delete. This forgets every paired watch with its paints and rooms.
3. In HACS, remove the Kestrel repository if you added it as a custom repository.
4. Uninstall Kestrel from the watch in the Zepp app.

## Development

See [docs/development.md](docs/development.md): layout, emulator, branches, test builds and releases.

```bash
npm install && npm test
cd watch && zeus build
```

## Support

If you find this useful, you can [sponsor the project](https://github.com/sponsors/raetha).

## License

[MIT](LICENSE), all of it: the watch app, the Home Assistant integration and the tooling. Forks are welcome; please give them a different name and icon, so people can tell them apart from Kestrel.

Kestrel is an independent project and is not affiliated with Zepp Health, Amazfit or Home Assistant.
