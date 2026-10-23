# Design

The full design plan, with diagrams, is the shared "Wristwand — Design Plan" doc. This file keeps the decisions the code depends on.

## The idea

Paint a device once (sweep your arm across it for about 15 seconds), then point at it and trigger (snap, flick, button or tap) to toggle it. A twist dims lights. Locks always need a confirming tap.

## Architecture

- **Watch** (`watch/`, Zepp OS device app): sensors, aim classification, triggers, room detection, haptics. Everything time-critical runs here, so aiming never waits on Bluetooth.
- **Phone** (`watch/app-side/`, side service in the Zepp app): the only part that talks to Home Assistant. The watch sends `{seq, target, action}`; the phone de-duplicates by `seq` and calls HA.
- **Settings page** (`watch/setting/`, in the Zepp app): HA URL and token for direct mode. Only store installs get it (sideloaded apps don't), and it never leaves the phone.
- **Home Assistant**: the `wristwand` component (component mode, pairing), or nothing installed (direct mode, store installs with the Settings page).

## Pairing

Sideloaded apps get no Settings page in the Zepp app, and typing a Nabu Casa address or a token on a watch is impractical, so the watch pairs with the component instead:

1. **Find.** The phone tries `http://homeassistant.local:8123`, `http://homeassistant:8123` and `https://homeassistant.local:8123` (plus any saved address) for `GET /api/wristwand/info`. iOS resolves `.local` names itself, so this works on the home Wi-Fi with nothing typed. (Neither the watch nor the phone side has an mDNS API of its own.)
2. **Code.** The watch asks HA to pair (`POST /api/wristwand/pair` with its name). HA shows a 6-digit code as a notification, valid 10 minutes. Requests are rate-limited per address.
3. **Confirm.** The code is typed on the watch's keypad (`POST /api/wristwand/pair/confirm`). Five wrong codes cancel the pairing. HA answers with a token for this watch (stored hashed in HA), its own name, and its internal and external (Nabu Casa) URLs.
4. **Use.** The phone keeps the token and every address; each request tries the last one that worked, then local ones, then remote, so it keeps working away from home. The token only works on `/api/wristwand/*` (sent as `X-WristWand-Token`, not `Authorization`, so HA's login ban never counts it). A 401 means the watch was removed in HA: the phone forgets the pairing.

A store install can still type a URL in the Settings page and pair with a code, or use direct mode with a token.

## Home Assistant: two modes

The side service calls `GET /api/wristwand/info` at startup; a 404 means direct mode. The watch code is the same in both.

| What | Direct mode | Component mode |
| --- | --- | --- |
| What you can paint | Entities | Targets: an entity, a script, or a virtual target that only fires an event |
| What a trigger does | Fixed per-domain action | Per-target action, set in the HA UI |
| Automations | Wrap logic in scripts | `wristwand_fired` event and device triggers |
| Safety | Enforced on the watch | Enforced in HA: confirm-required domains, away mode (person not home: only allowed entities) |
| Paints, rooms, settings | On the watch only | Master copy in HA (`watchdata.py`), editable in the integration's options; the watch syncs by revision (`watch/lib/sync.js`) |
| Room | Watch Bluetooth fingerprint | Watch fingerprint, or HA presence (Bermuda, ESPHome proxies, room sensors) |
| Round trip | Service call | `POST /api/wristwand/fire` returns the new state |
| Setup | Settings page: URL + long-lived token (store installs only) | Pairing code; nothing to copy |

Direct mode filters entities with an HA label `wristwand` (all supported entities if no entity has it) and groups them by Area; entities without an Area show under "Unassigned".

## Pointing model

- Aim = the forearm's compass heading plus its pitch (`attitude()` in `watch/lib/aim.js`). The watch's compass heading is already tilt-compensated and reads 90° clockwise of the forearm, so the forearm heading is that minus 90°. Pitch and roll come from the accelerometer's gravity vector; the forearm runs along the watch's 3–9 o'clock axis (x). Roll is also used for the dimming twist.
- Aim gate: the arm must be still (gyro under about 30°/s for 300 ms), pitch within ±70°, roll within ±45° for at least 1.5 s (the compass is smoothed and lags after the wrist turns), compass calibrated. The limits are symmetric, so the left wrist works without a setting.
- A paint stores, per device and room, one or more spots: circular mean heading and spread, mean pitch and spread, and up to 60 samples. Heading maths is always circular (`lib/circular.js`).
- Classification scores each spot with a 2D Gaussian; states are resting, aiming, candidate (show the name) and locked (margin over the runner-up). A wrong guess offers the runner-up; corrections add a small spot where the arm was.
- Rooms: spots are tagged with the room they were painted in. When the current room is known (a Bluetooth scan matched against calibrated fingerprints, `watch/lib/rooms.js`, or a Home Assistant sensor), only that room's spots and untagged ones count. Point checks the room when it opens and every 45 s.
- Dimming: hold the select button or the circle (450 ms) on a dimmable light and twist; a quarter turn is the whole range (`watch/lib/dim.js`). Release sends `brightness_step_pct`.

## Triggers

Physical button, screen tap, and a gesture: wrist flick, finger snap or finger tap. With motion sensors at 25 Hz (see below), gestures are recognised by the movement of the wrist, not a click, and calibrated per person on the watch (`watch/lib/gesture.js`).

- **Gesture**: two channels, the gyro (how fast the wrist turns; flicks) and the jolt (how far the accelerometer jumps between readings; snaps and taps). Calibration records five gestures and a few seconds of ordinary aiming, and sets a threshold on each channel where the gesture stands at least 1.5 times above aiming (geometric midpoint); a channel that doesn't separate is left off. A burst must cross its threshold within 400 ms of starting, then 1.2 s of quiet. Gestures only count while aiming, against the device the aim had in mind when the burst began (within 800 ms). Default before calibration: wrist flick, gyro 600°/s.
- **Corrections**: after a trigger, "Not it?" offers the runner-up for 5 s. It toggles the first device back where that undoes it (lights, switches, fans, input booleans, media players, covers), toggles the runner-up, and adds a small correction spot where the arm was. A device keeps at most two correction spots apart from its painted ones.
- **Aim traces**: each trigger sends the aim of the seconds before it (heading, pitch, roll, state, best guess) to Home Assistant as a `point` probe result, for replaying the classifier offline.
- **Sync**: Home Assistant holds the master copy of each watch's paints, rooms and settings, each with a revision. The watch sends a section right after changing it, and syncs everything when the app starts and on Sync: if Home Assistant didn't change, the watch's copy stands; if it did (edited in the options), Home Assistant's copy wins, plus whatever the watch changed since.
- **Away mode** (Home Assistant): while the chosen person isn't home, `fire` refuses all but the allowed entities.

## What the real watch measured (M0, Balance 3)

- **Motion sensors: 25 Hz.** The accelerometer and gyro deliver about 25 readings a second in every mode (Sensor rates probe). NORMAL and HIGH deliver one every 40 ms; LOW saves them up and delivers bursts about twice a second, so readings arrive late and with useless timestamps. Use NORMAL. Zepp OS has no faster API. A finger snap's click lasts about 10 ms and falls between readings; the wrist's turn during a snap (a gyro swing of roughly 200°/s over 200 ms) does show.
- **Axes.** Raising and lowering the arm moves gravity along x, so the forearm is the 3–9 o'clock axis (y, 12 o'clock, points across the wrist).
- **Compass.** Apps get one heading (`getDirectionAngle()`) and no raw magnetic field. It is tilt-compensated for pitch: it held within about 2° while the arm moved from 10° below level to 22° above along one line (three recordings). Turning the wrist shifts it: 5–25° with the thumb up, 25–45° palm up, and it creeps back over a few seconds once the palm is down again, because it is heavily smoothed. It reads 90° clockwise of where the forearm points. It has a new value about 4 times a second at most: LOW gives one every 2 s or so, NORMAL about 4 a second, and HIGH calls back 13 times a second but mostly repeats values. Use NORMAL. So aim needs the palm roughly down (within 45°) and waits 1.5 s after the wrist was turned further. If aim feels laggy, the gyro (25 Hz) can fill in between compass updates.
- **Screen off.** Zepp OS closes an app about 10 s after its screen goes off, and the watch wakes to the watch face. Keeping the screen on with `pauseDropWristScreenOff` for a whole page made back and swipes close the app once the normal timeout had passed. Point instead asks to be reopened on wake (`setWakeUpRelaunch`); probes and Paint keep the screen on only while they run.
- **Latency depends on the phone.** With the Zepp app open on an unlocked iPhone: watch ↔ phone 0.18 s, phone ↔ Home Assistant 0.08 s, watch → phone → Home Assistant 0.24 s, all very steady. With the phone locked and another app in front: watch ↔ phone 0.63 s and the whole trip 1.12 s, also very steady, so iOS seems to slow the Bluetooth link to a fixed rhythm in the background. Nothing on the watch changes that, so the watch buzzes as soon as a command is sent rather than waiting for the result.
- **Gestures** (one recording each so far, peak gyro rate and peak acceleration change): wrist flick 1521°/s and 2785; snap 49–273°/s and 93–877 over six recordings; arm wave 139°/s; finger tap 88°/s; nothing 3°/s. A wrist flick stands far apart from everything else, so it is the first gesture trigger to build; a snap overlaps ordinary movement. Per-person calibration on the watch will set the thresholds.
- **Bluetooth scan** (one scan, an office): 24 steady devices (building beacons, door readers), each seen once in a scan. Enough to fingerprint a room; home results still to come.

## Milestones

1. **M0 Spike**: measurement probes. Done.
2. **M1 One lamp**: pairing, side service, entity sync, paint, button trigger, haptic acknowledgement. Built; home test pending.
3. **M2 Whole room**: classifier, aim states, corrections, the HA component, paint backup, aim traces (replay tests to come with real traces). Built.
4. **M3 Whole house**: room fingerprints, gestures, lock confirmation, dimming, away mode, management in Home Assistant. Built; home test pending.
5. **M4 Ship it**: polish, battery, other round Zepp watches, first release.
