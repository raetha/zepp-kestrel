<p align="center"><img src="brand/kestrel.svg" width="128" alt="Kestrel logo: a kestrel diving at a target"></p>

# Kestrel

Point your Amazfit watch at a smart-home device and trigger it. Hold your arm still on the lamp across the room, the way a kestrel hangs still in the wind over its target, then flick your wrist and the light comes on. An open-source pointing remote for Zepp OS watches, built around [Home Assistant](https://www.home-assistant.io/).

> **Status: feature-complete test builds, before release polish.** Pair the watch with Home Assistant, paint devices, point, and trigger with the select button, a tap or a gesture (wrist flick, finger snap or finger tap). Twist to dim lights. Rooms are recognised by Bluetooth (or a Home Assistant sensor). Paints, rooms, settings and which devices watches can use are managed in Home Assistant. It works on your home network (or a VPN into it), never through Home Assistant Cloud. There is no release yet.

<p align="center">
  <img src="watch/docs/screenshot-menu.png" width="240" alt="Kestrel probe menu on the watch">
</p>

## How it will work

1. **Paint** each device once: sweep your arm across it for about 15 seconds.
2. **Point** at it. The watch shows what it thinks you mean.
3. **Trigger**: snap, flick, press a button or tap. A slow wrist roll while locked dims lights. Locks always ask for a confirming tap.

It needs the Kestrel Home Assistant integration: the watch pairs with a code instead of a copied token, lists your devices by area, only works on your home network (pointing is for the device in front of you), and every action fires a `kestrel_fired` event for automations. The phone only ever talks to the integration, with the watch's own token: never to Home Assistant's general API. See [docs/design.md](docs/design.md).

## Try the test build

Test builds are for development and change often.

**1. Install the Home Assistant component.** In HACS: ⋮ → Custom repositories → `https://github.com/raetha/zepp-kestrel`, type Integration, then open Kestrel. There's no release yet, so first turn on its test builds: ⋮ → Redownload → switch on **Show beta versions** → pick the newest `ha-v…-dev.N` → Download, then restart Home Assistant. (Each push to `dev` publishes a new one; HACS offers it as an update.) Or copy `custom_components/kestrel` from the `dev` branch into your HA config folder. Then Settings → Devices & services → Add integration → Kestrel.

**2. Install the watch app.**
1. In the Zepp app, turn on Developer Mode: Profile → Settings → About, tap the Zepp logo 7 times.
2. Open the [test-build page](https://raetha.github.io/zepp-kestrel/dev/) on another screen and pick your watch (each screen size needs its own package; see [Supported devices](#supported-devices)).
3. In the Zepp app: Profile → your watch → Developer Mode → scan icon (top right). Scan the QR code and confirm. It never changes and always installs the newest build; the home screen shows the build number at the bottom.

**3. Pair.** With your phone on the home Wi-Fi, open Kestrel DEV on the watch → Pair with HA. Pick your Home Assistant, then type the 6-digit code from the notification Home Assistant shows. The watch then fetches your devices. (If the Zepp app asks for Local Network access, allow it: that's how the phone finds `homeassistant.local`.)

**4. Paint and point.** Paint a device: pick it, stand where you'd use it, press Start, and sweep your arm slowly across it for 15 s, palm down. Then Point: hold your arm out at it, palm down. The screen turns amber while you aim, then bright green (with one buzz) when the watch has locked onto a device; press the select button, tap the screen, or do your gesture to toggle it. A second buzz and a green flash say it's done; red means it failed. Locks ask for a confirming tap. If the watch picked the wrong device, tap **Not it?** within 5 s: it undoes the first (lights, switches, fans and the like), toggles the right one, and remembers where you aimed. Dropping your wrist and raising it again brings Point back.

To test without your own devices nearby (at work, say), create a helper in Home Assistant (Settings → Devices & services → Helpers → Toggle), Sync, and paint something in the room, like a door frame, as that helper.

**5. Dim and volume.** Once a dimmable light is locked, keep your arm where it is and slowly roll your wrist: thumb up brightens, thumb down dims, a quarter turn is the whole range. The screen switches to the dimmer as soon as you've turned about 20°; hold still for a second (or lower your arm) and it's sent. Roll slowly: a quick turn reads as a wrist flick. You can also hold the select button (or a finger on the screen) while you twist, and let go to send it. On a media player that has a volume control, the same twist changes its volume, with safety limits set in Home Assistant: one twist changes it by at most 20% (a quarter turn is the whole 20%), twists are at least a second apart, and twisting never raises it above 80% (turning it down always works). Both limits can be changed per watch.

**6. Gesture.** More → Gesture: choose wrist flick, finger snap or finger tap, then Calibrate: five gestures after the buzzes, then a few seconds of slowly pointing around. The watch learns thresholds that separate your gesture from aiming, and keeps them per gesture, so you can switch later (on the watch or with the Gesture select in Home Assistant) without calibrating again. It only counts while you're aiming at something, and only once: gestures are ignored for 3 seconds after a trigger.

**7. Instant toggle.** More → Instant: Off, 2 s, 3 s or 5 s (any delay from 1 to 10 s in Home Assistant). With it on, holding the aim locked on a device that long triggers it, no button or gesture needed; the screen counts down. It fires once per hold: look away and back to trigger the same device again. Locks still need a press.

**8. Rooms.** More → Rooms lists your Home Assistant areas. Calibrate each room you point in, and any room you stand in often even if you don't point there (an uncalibrated room gets taken for whichever room sounds most like it): walk around it for three short Bluetooth scans. Paint devices afterwards, from inside each room. When the watch is sure which room you're in, only devices painted from that room (and paints made without a room) can be picked, so a light in the next room that lines up through a wall or doorway never wins; to use it from here, paint it again from here. When it only just placed you (the room name shows a "?"), devices painted in other rooms count half, so a wrong guess doesn't hide them (open-plan rooms often sound alike to Bluetooth; calibration says so). "Where am I?" tests it. If you already track rooms in Home Assistant (for example Bermuda), choose that sensor in the integration's options instead.

Better room detection. The watch tells rooms apart by which Bluetooth devices it hears and how loudly, so it does best with a few devices that stay put and advertise all the time (smart plugs, bulbs, hubs, Bluetooth proxies, a cheap beacon). It ignores phones, watches and other devices that change their address. Many homes have only a handful; with the same few heard everywhere, neighbouring rooms sound alike. Ways to improve it:
- Calibrate again whenever the Bluetooth around you changes: new or moved plugs, bulbs or Bluetooth proxies (for example when setting up Bermuda).
- Add one fixed device per hard room: anything that advertises over Bluetooth helps, ideally where the room's neighbours can barely hear it. An ESPHome board can advertise as a beacon (ESPHome's BLE beacon component; check it works alongside a Bluetooth proxy on the same board).
- Use a Home Assistant area sensor instead. Bermuda (with a Bluetooth proxy in each room) tracks devices by area; if it can follow your phone (Home Assistant's Private BLE Device integration tracks an iPhone) or your watch, choose that sensor under Room from. It then reflects where that device is, so it fits best when the phone stays on you.

The phone can't help on its own: the Zepp app gives Kestrel no access to the phone's location or Bluetooth, and indoors phone location is metres off, coarser than a room.

**9. Launch from the shortcut key.** More → Open on: Point. Then assign Kestrel to the watch's shortcut button in the watch's own settings (where it lets you choose an app for the button). Pressing it opens Kestrel straight on Point; back goes to the home screen.

**10. Scenes and scripts as virtual spots.** A scene, script or button has no place in the room, so give it one: Paint → Scenes & more, pick it, and paint any spot you like (the sofa for a movie scene, the window for "close all blinds"). Pointing there runs it.

**11. Learning.** Kestrel improves with use (on by default; turn it off with the Learn from use switch in Home Assistant). Each trigger that locked on clearly and wasn't corrected with "Not it?" adds a small vote for where that device is from where you stood, kept in up to three learned spots per device next to your paints (which it never changes); a vote that would crowd another device isn't kept. Room calibrations follow slow changes in what Bluetooth hears when a room check matches one room clearly. It can't yet work out where devices are in your home's layout from paints made in different places: that needs to know where you are standing, which Bluetooth rooms are too coarse for.

**Managing things in Home Assistant.** Settings → Devices & services → Kestrel → Configure:
- **Painted devices**: remove a bad paint (the newest spot) or all of a device's paints, or make a paint trigger a different entity.
- **Rooms**: delete a room's calibration.
- **Devices for watches**: choose which devices (or single entities) watches can paint and trigger, with Home Assistant's searchable pickers. Leave it empty to offer everything.
- **Settings** (per watch): gesture on or off, which gesture and its thresholds; instant toggle and its delay; opening on Point; learning from use; the volume limit and change per twist; where the current room comes from.

The watch picks changes up on its next Sync (it also syncs quietly each time the app starts). Paints, rooms and settings live in Home Assistant, so a reset or new watch gets them back on Sync.

The watch is offered every supported entity except hidden, disabled, and devices' configuration or diagnostic entities, up to 1000 (Sync shows "1000 of N devices" when some are left out). To offer only some, choose them under Configure → Devices for watches; watches get the new list when they next sync. Each paired watch appears in Home Assistant as a device under the Kestrel integration; delete the device to unpair it.

**On each watch's device page** in Home Assistant:

| Entity | What it shows |
| --- | --- |
| Last triggered | The device the watch last triggered; attributes say how (button, tap, flick, snap, dim), from which room and when. Handy for automations along with the `kestrel_fired` event. |
| Room | The room the watch last placed itself in (only updated while Kestrel is open). |
| Gesture trigger (switch) | Turns the flick/snap/tap trigger on or off, for example from an automation while you work out. |
| Gesture (select) | Which gesture triggers: wrist flick, finger snap or finger tap. Each keeps its own calibration, so switching is instant; a snap or tap that was never calibrated asks for calibration on the watch. |
| Instant toggle (switch), Instant toggle delay (number) | Trigger by holding the aim on a device, and for how long (1–10 s). |
| Gesture gyro threshold, Gesture jolt threshold (numbers, disabled by default) | The current gesture's calibrated thresholds, to nudge if it triggers too easily (raise) or too hard (lower). |
| Room from (select) | The watch's own Bluetooth room calibration, or a Home Assistant sensor (chosen under Configure). |
| Open on Point (switch) | Start the app on Point, for launching it from the watch's shortcut key. |
| Learn from use (switch) | Let confirmed triggers refine paints and clear room checks refine room calibrations. |
| Volume limit, Volume change per twist (numbers) | Twisting at a media player never raises the volume above the limit (10–100%), and one twist changes it by at most the change per twist (5–50%). |
| Paint map (image) | One compass dial per room with every paint where it was made: north up, higher spots (ceiling lights) towards the centre, lower ones towards the edge, each as wide as it was painted. Filled: painted; outlined: learned; dots: corrections. Shows at a glance which devices crowd each other. |
| Last seen, Home Assistant address, Painted devices, Calibrated rooms | Diagnostics: when the watch last talked to Home Assistant, the address it used, and what it has set up. |

The device's software version is the watch app's build. Changes reach the watch on its next sync. Every setting is also under Configure; the room sensor only there.

**In the Zepp app** (store installs: sideloaded test builds get no settings page), the app's settings page shows the same settings (gesture, instant toggle, room source) and changes them in Home Assistant.

If your phone can't find Home Assistant (another port, or a name other than `homeassistant.local`), choose **Type address** on the watch and enter its IP address, with `:port` if it isn't 80 or 8123.

### Running the M0 probes

Under **More → Probes** on the watch. Results show on the watch, and once the watch is paired each one (raw sensor traces included) also goes to Home Assistant; the probe screen says whether it got there. To hand results over, download them in one file: Settings → Devices & services → Kestrel → your watch's device → ⋮ → **Download diagnostics**. Home Assistant keeps the newest 500 results for up to 14 days. Each also fires a `kestrel_probe` event, for watching live in Developer tools → Events. The select button presses the main button on every probe screen; back returns to the list.

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

Zepp OS watches with a compass (API level 3.6 or later, and in practice Zepp OS 4), with the Zepp app on a phone. A gyroscope helps (steadier aim, and the wrist flick needs it); without one, stillness comes from the accelerometer and snaps and taps still work. A watch without a compass says so: it can't tell where you point. Layouts are designed for 480 × 480 round, scale to the screen, and sit centred on square ones (square watches also show the system's title bar along the top).

Each model below was run on Zepp's own emulator image of its firmware (`tools/compat/sweep.mjs`): the app installed, opened, and went through Home, Point, Paint and More. The emulator can't tell whether a watch really has a compass or gyroscope, so those columns come from specifications. The install pages offer the right package for each supported model; please report how it goes on yours.

<!-- models:start -->
| Watch | Screen | API | Kestrel | Compass | Gyroscope | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Balance 3 | round 480 | 4.4 | Works (tested on the watch) | yes | yes | Development watch. |
| Balance 2 | round 480 | 4.2 | Runs in the emulator | yes | yes |  |
| Balance | round 480 | 4.0 | Runs in the emulator | yes | yes |  |
| Active Max | round 480 | 4.2 | Runs in the emulator | yes | yes |  |
| T-Rex Ultra 2 | round 480 | 4.3 | Runs in the emulator | yes | not confirmed |  |
| T-Rex 3 | round 480 | 4.0 | Runs in the emulator | yes | not confirmed |  |
| T-Rex 3 Pro (44 mm) | round 466 | 4.2 | Runs in the emulator | yes | yes |  |
| Active 3 Premium | round 466 | 4.3 | Runs in the emulator | yes | yes |  |
| Active 2 (round) | round 466 | 4.2 | Runs in the emulator | not confirmed | not confirmed |  |
| Active 2 (square) | square 390×450 | 4.2 | Runs in the emulator | yes | yes |  |
| Bip 6 | square 390×450 | 4.2 | Runs in the emulator | not confirmed | not confirmed |  |
| Bip Max | square 432×514 | 4.4 | Runs in the emulator | not confirmed | not confirmed |  |
| Balance Ultra | round 480 | 4.4 | Should work (not checked) | not confirmed | not confirmed | No emulator image; uses the same package as the Balance 3. |
| T-Rex 3 Pro (48 mm) | round 480 | 4.3 | Should work (not checked) | yes | yes | Its emulator image is a test build that couldn't open apps; same package as the T-Rex 3. |
| Cheetah 2 Pro | round 466 | 4.3 | Should work (not checked) | yes | yes | No emulator image; same package as the Active 2. |
| Falcon | round 416 | 3.6 | Not supported | – | – | Crashes on its Zepp OS 3.x firmware as soon as a screen runs the app's background work (asynchronous functions); may work if the watch has a newer Zepp OS. |
| Cheetah (round) | round 454 | 3.6 | Not supported | – | – | Crashes on its Zepp OS 3.x firmware as soon as a screen runs the app's background work (asynchronous functions); may work if the watch has a newer Zepp OS. |
| T-Rex Ultra | round 454 | 3.6 | Not supported | – | – | Crashes on its Zepp OS 3.x firmware as soon as a screen runs the app's background work (asynchronous functions); may work if the watch has a newer Zepp OS. |
| Cheetah Pro | round 480 | 3.6 | Not supported | – | – | Crashes on its Zepp OS 3.x firmware as soon as a screen runs the app's background work (asynchronous functions); may work if the watch has a newer Zepp OS. |
| Cheetah (square) | square 390×450 | 3.6 | Not supported | – | – | Crashes on its Zepp OS 3.x firmware as soon as a screen runs the app's background work (asynchronous functions); may work if the watch has a newer Zepp OS. |
| Active | square 390×450 | 3.6 | Not supported | – | – | Crashes on its Zepp OS 3.x firmware as soon as a screen runs the app's background work (asynchronous functions); may work if the watch has a newer Zepp OS. |
| Active Edge | round 360 | 3.5 | Not supported | – | – | API level 3.5, below the 3.6 Kestrel needs; Zeus still builds a package for its screen. |
| Cheetah 2 Ultra | round 480 | 4.3 | Not supported | yes | not confirmed | Zeus builds no package for it. |
| GTR 4 | 466×466 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| GTS 4 | 390×450 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| GTS 4 Mini | 336×384 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| GTR 3 Pro | 480×480 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| GTR 3 | 454×454 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| GTS 3 | 390×450 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| T-Rex 2 | 454×454 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| GTR Mini | 416×416 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| Bip 5 | 320×380 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| Bip 5 Unity | 320×380 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |
| Band 7 | 194×368 | < 3.6 | Not supported | – | – | Zeus builds no package for it (API level below 3.6). |

Checked 2026-10-24. Compass and gyroscope are from the watches' specifications ("not confirmed": not found in them).
<!-- models:end -->

The watch can trigger lights, switches, fans, media players, locks, covers, climate entities, scenes, scripts, buttons, input buttons and input booleans.

### Supported functions

- **Pairing**: a code shown in Home Assistant, typed on the watch; each watch gets its own token, limited to Kestrel's API.
- **Triggering**: toggle (or the domain's natural action: press a button, run a scene or script, play/pause media); locks always ask for a confirming tap; dimming and media volume with a wrist twist (volume limited per twist, spaced, and capped).
- **Entities per watch**: see the table above (sensors, switches, selects, numbers, and the paint map image).
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
- Watches only work on your home network, or a VPN into it (WireGuard, Tailscale and the like). Requests through Home Assistant Cloud (Nabu Casa) or from a public address are refused, so a lost watch or phone can't switch things from outside. If your phone drops Wi-Fi for mobile data at home, the watch says Home Assistant isn't reachable until it's back on Wi-Fi.
- Up to 1000 entities are offered to a watch; choosing devices for watches in Configure narrows the list.
- Finger snaps and taps move the watch little, so they may not calibrate well; a wrist flick is the most reliable gesture.

### Troubleshooting

- **"Phone not reachable"**: the Zepp app must be running on the phone (in the background is fine) and connected to the watch over Bluetooth.
- **"Kestrel only works on your home network"** or **"Home Assistant not reachable"**: the phone must be on your home Wi-Fi (or a VPN into it). Kestrel never goes through Home Assistant Cloud.
- **Pairing can't find Home Assistant**: your phone must be on the home Wi-Fi, with the Kestrel integration added. Choose Type address on the watch and enter Home Assistant's IP (and port, if not 80 or 8123). More shows the address in use once paired.
- **Wrong room, or the room shows "?"**: calibrate the room again (and any room nearby you haven't calibrated), especially after adding or moving Bluetooth devices; see Better room detection under Rooms above.
- **Nothing locks on when pointing**: calibrate the compass (the Compass app, or turn the watch in a circle when asked, until the dots round the edge go green), then paint again from where you stand.
- **Two devices get mixed up**: paint each of them from where you stand when you use them, sweeping only across the device itself (a narrow sweep is a precise paint). If Paint says they're too close from there, paint them from another spot as well. Use **Not it?** when it picks the wrong one: it teaches the watch where you aimed.
- **Wrong device triggers**: use "Not it?" right after to correct it, or paint again from that spot.
- **Something else**: turn on **Detailed diagnostics** on your watch's device page, use Kestrel until the problem shows, then Settings → Devices & services → Kestrel → your watch → ⋮ → Download diagnostics, and attach it to an issue.

### Diagnostics and privacy

By default Kestrel keeps little: probes you run on purpose (More → Probes) and, when something goes wrong on the watch, the record of screens, buttons and errors leading up to it. Nothing about where you point, your rooms' Bluetooth surroundings or your battery is kept.

**Detailed diagnostics** (a switch on each watch's device page, also under Configure) has the watch also send, for one week before it turns itself off:
- the aim of the few seconds before each trigger, and of aims held out that never triggered, to tune pointing (with the room checks made while pointing);
- the readings of each Paint sweep;
- the record of screens, buttons and swipes of every run, and battery levels while pointing;
- the raw Bluetooth scans of room calibrations.

Home Assistant keeps at most 500 results, 2 million characters in all, for up to 14 days; recorded aim traces and trails never go into Home Assistant's event history. Nothing is written to Home Assistant's log beyond a line when a watch pairs.

A diagnostics download is made to be attached to a public issue. It never holds a token (Home Assistant only stores a hash of each watch's token, and leaves even that out) or a network address, and every Bluetooth address (the watch hears neighbours' devices too) is replaced by a code that's the same throughout one download, so room matching can still be checked, but can't be turned back into the address. It does hold your device and room names, entity ids and where you painted things; look it over before posting it.

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
