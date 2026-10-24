# Design

The full design plan, with diagrams, is the shared "Kestrel — Design Plan" doc. This file keeps the decisions the code depends on.

## The idea

Paint a device once (sweep your arm across it for about 15 seconds), then point at it and trigger (snap, flick, button or tap) to toggle it. A twist dims lights. Locks always need a confirming tap.

## Architecture

- **Watch** (`watch/`, Zepp OS device app): sensors, aim classification, triggers, room detection, haptics. Everything time-critical runs here, so aiming never waits on Bluetooth.
- **Phone** (`watch/app-side/`, side service in the Zepp app): the only part that talks to Home Assistant. The watch sends `{seq, target, action}`; the phone de-duplicates by `seq` and calls HA.
- **Settings page** (`watch/setting/`, in the Zepp app): the watch's settings (stored in Home Assistant) and probe results. Only store installs get it (sideloaded apps don't).
- **Home Assistant**: the `kestrel` integration is required. The phone only talks to its `/api/kestrel/*` endpoints with the watch's own token, never to Home Assistant's general API or with a long-lived token.

## Pairing

Sideloaded apps get no Settings page in the Zepp app, and typing an address or a token on a watch is impractical, so the watch pairs with the component instead:

1. **Find.** The phone tries `http://homeassistant.local:8123`, `http://homeassistant:8123` and `https://homeassistant.local:8123` (plus any saved address) for `GET /api/kestrel/info`. iOS resolves `.local` names itself, so this works on the home Wi-Fi with nothing typed. (Neither the watch nor the phone side has an mDNS API of its own.)
2. **Code.** The watch asks HA to pair (`POST /api/kestrel/pair` with its name). HA shows a 6-digit code as a notification, valid 10 minutes. Requests are rate-limited per address.
3. **Confirm.** The code is typed on the watch's keypad (`POST /api/kestrel/pair/confirm`). Five wrong codes cancel the pairing. HA answers with a token for this watch (stored hashed in HA), its own name, and its home-network URL (never a cloud one).
4. **Use.** The phone keeps the token and the home addresses; each request tries the last one that worked first. Kestrel works on the home network only (or a VPN into it): every endpoint refuses requests through Home Assistant Cloud or from a public address, because the point is the device in front of you, and a lost token is then useless from outside. The token only works on `/api/kestrel/*` (sent as `X-Kestrel-Token`, not `Authorization`, so HA's login ban never counts it). A 401 means the watch was removed in HA: the phone forgets the pairing.

## What the integration does

- **What you can paint**: the devices and entities chosen under Configure → Devices for watches (everything, if nothing is chosen), grouped by area.
- **Safety**, enforced in Home Assistant: home network only, only the devices chosen for watches, confirm-required domains (locks), every value from a watch checked.
- **Paints, rooms, settings**: master copy in Home Assistant (`watchdata.py`), editable in Configure and through entities; the watch syncs by revision (`watch/lib/sync.js`).
- **Room**: the watch's Bluetooth fingerprint, or a Home Assistant sensor (Bermuda, ESPHome proxies, room sensors).
- **Round trip**: `POST /api/kestrel/fire` returns the new state (and brightness for lights).
- **Automations**: the `kestrel_fired` event, and per-watch entities.

Entities without an area show under "No area".

## Pointing model

- Aim = the forearm's compass heading plus its pitch (`attitude()` in `watch/lib/aim.js`). The watch's compass heading is already tilt-compensated and reads 90° clockwise of the forearm, so the forearm heading is that minus 90°. Pitch and roll come from the accelerometer's gravity vector; the forearm runs along the watch's 3–9 o'clock axis (x). Roll is also used for the dimming twist.
- Aim gate: the arm must be still (gyro under about 30°/s for 300 ms), pitch within ±70°, roll within ±45° for at least 1.5 s (the compass is smoothed and lags after the wrist turns), compass calibrated. The limits are symmetric, so the left wrist works without a setting.
- A paint stores, per device and room, one or more spots: circular mean heading and spread, mean pitch and spread, and up to 60 samples. Heading maths is always circular (`watch/lib/circular.js`).
- Classification scores each spot with a 2D Gaussian (heading sigma 6–15°, pitch at least 5°); states are resting, aiming, candidate (show the name) and locked (a 2x lead over the runner-up). The score (0..1) says whether anything matches; which device wins, and by how much, goes by the Gaussian's density (the score divided by the spot's width). Comparing plain scores let a widely swept spot claim the space next to a tight one: on a Balance 3, a chandelier swept ±14° beat an island light 18° away until the arm was within 5° of the island, and the island never locked. A wrong guess offers the runner-up; corrections add a small spot where the arm was.
- Crowding: after painting, the watch says when another device's spot would keep the new one from locking (`crowdedBy()` in `watch/lib/paint.js`), so it can be painted again from where the two stand further apart.
- Rooms: spots are tagged with the room they were painted in. When the current room is known (a Bluetooth scan matched against calibrated fingerprints, `watch/lib/rooms.js`, or a Home Assistant sensor), that room's spots and untagged ones count fully and other rooms' spots count half (`OTHER_ROOM_PRIOR`): enough to settle a tie between rooms, without hiding the next room when the room is wrong or you point through a doorway. Open-plan rooms sound alike to Bluetooth (a real kitchen and dining room matched each other at 0.56, and a third of their own calibration scans were undecided), so Rooms says so after calibrating (`soundsLike()`). Point checks the room when it opens and every 60 s (a 3 s Bluetooth scan each time).
- Dimming: hold the select button or the circle (450 ms) on a dimmable light and twist; a quarter turn is the whole range (`watch/lib/dim.js`). Release sends `brightness_step_pct`.

## Feedback on the watch

Readable at arm's length without looking closely, and few buzzes:

- **Colour.** Point's whole screen is the state: black resting, amber aiming, dark green candidate, bright green locked, purple dimming, dark red confirm; a bright green flash when an action is done and red when it failed. Paint is amber while recording, green when saved, red when not. Text is black on the bright colours.
- **Buzzes.** Point: one when it locks onto a device (not again for the same device until the arm is lowered), one when the action is done or failed. Paint: compass calibrated, recording starts, recording ends. Calibrations: a buzz only where you must act without looking (each gesture of a gesture calibration, start and end).
- **Compass calibration.** Apps only learn that the compass is calibrated, not how far along it is (no raw field). While waiting, a ring of 12 dots lights as the watch leans each way (`watch/lib/circling.js`), which shows the circling motion is happening; all go green when Zepp OS says it's calibrated.

## Triggers

Instant toggle (`settings.dwell`, off by default): holding the aim locked on one device for 1–10 s (3 s default) triggers it with no button or gesture (`watch/lib/dwell.js`). Brief flickers out of the lock (under 0.3 s) don't restart the count; after it fires, that device re-arms only once the aim has left it for 1 s, so holding still toggles once. Locks never fire this way. Any other trigger counts as the trigger for that hold.

Physical button, screen tap, and a gesture: wrist flick, finger snap or finger tap. With motion sensors at 25 Hz (see below), gestures are recognised by the movement of the wrist, not a click, and calibrated per person on the watch (`watch/lib/gesture.js`).

- **Gesture**: two channels, the gyro (how fast the wrist turns; flicks) and the jolt (how far the accelerometer jumps between readings; snaps and taps). Calibration records five gestures and a few seconds of ordinary aiming, and sets a threshold on each channel where the gesture stands at least 1.5 times above aiming (geometric midpoint); a channel that doesn't separate is left off. A burst must cross its threshold within 400 ms of starting, then 1.2 s of quiet. Gestures only count while aiming, against the device the aim had in mind when the burst began (within 800 ms). After a trigger, gestures are ignored for 3 s (one gesture, one toggle), and around each of the watch's own buzzes: a buzz jolts the accelerometer like a snap (seen on a Balance 3: a snap calibrated at jolt 193 toggled a light again about 2 s later). Each gesture keeps its own calibration (`settings.gesture.calibrations[kind]`), so the gesture can be switched on the watch or from Home Assistant's Gesture select without recalibrating; uncalibrated, only a flick works (gyro 600°/s). Default before calibration: wrist flick, gyro 600°/s.
- **Corrections**: after a trigger, "Not it?" offers the runner-up for 5 s. It toggles the first device back where that undoes it (lights, switches, fans, input booleans, media players, covers), toggles the runner-up, and adds a small correction spot where the arm was. A device keeps at most two correction spots apart from its painted ones.
- **Aim traces**: each trigger sends the aim of the seconds before it (heading, pitch, roll, state, best guess) to Home Assistant as a `point` probe result, for replaying the classifier offline.
- **Sync**: Home Assistant holds the master copy of each watch's paints, rooms and settings, each with a revision. The watch sends a section right after changing it, and syncs when the app starts and on Sync: if Home Assistant didn't change, the watch's copy stands; if it did (edited in the options), Home Assistant's copy wins, plus whatever the watch changed since. At launch the watch says what it has (each section's revision and a hash of the target and area lists) and Home Assistant leaves out what didn't change, so an ordinary launch moves a few dozen bytes; the Sync button fetches everything. Targets travel compactly (id, name, area_id, flags only when set). A changed `watch_id` (paired again) resets the revisions; the watch's own paints and rooms are sent to the new pairing.

## What the real watch measured (M0, Balance 3)

- **Motion sensors: 25 Hz.** The accelerometer and gyro deliver about 25 readings a second in every mode (Sensor rates probe). NORMAL and HIGH deliver one every 40 ms; LOW saves them up and delivers bursts about twice a second, so readings arrive late and with useless timestamps. Use NORMAL. Zepp OS has no faster API. A finger snap's click lasts about 10 ms and falls between readings; the wrist's turn during a snap (a gyro swing of roughly 200°/s over 200 ms) does show.
- **Axes.** Raising and lowering the arm moves gravity along x, so the forearm is the 3–9 o'clock axis (y, 12 o'clock, points across the wrist).
- **Compass.** Apps get one heading (`getDirectionAngle()`) and no raw magnetic field. It is tilt-compensated for pitch: it held within about 2° while the arm moved from 10° below level to 22° above along one line (three recordings). Turning the wrist shifts it: 5–25° with the thumb up, 25–45° palm up, and it creeps back over a few seconds once the palm is down again, because it is heavily smoothed. It reads 90° clockwise of where the forearm points. It has a new value about 4 times a second at most: LOW gives one every 2 s or so, NORMAL about 4 a second, and HIGH calls back 13 times a second but mostly repeats values. Use NORMAL. So aim needs the palm roughly down (within 45°) and waits 1.5 s after the wrist was turned further. If aim feels laggy, the gyro (25 Hz) can fill in between compass updates. Calibration is the watch's own: until it's done, `getDirectionAngle()` returns `INVALID`, and without the raw field an app can't calibrate or correct it itself. It is lost when the magnetic surroundings change (seen while walking between two spots in a kitchen); on the Balance 3 the Compass app recalibrates by turning the watch in a circle. Local distortion that stays put doesn't matter: a spot is painted and matched in the same place, so only repeatability counts, not true north.
- **Screen off.** Zepp OS closes an app about 10 s after its screen goes off, and the watch wakes to the watch face. Keeping the screen on with `pauseDropWristScreenOff` for a whole page made back and swipes close the app once the normal timeout had passed. Point instead asks to be reopened on wake (`setWakeUpRelaunch`); probes and Paint keep the screen on only while they run.
- **Latency depends on the phone.** With the Zepp app open on an unlocked iPhone: watch ↔ phone 0.18 s, phone ↔ Home Assistant 0.08 s, watch → phone → Home Assistant 0.24 s, all very steady. With the phone locked and another app in front: watch ↔ phone 0.63 s and the whole trip 1.12 s, also very steady, so iOS seems to slow the Bluetooth link to a fixed rhythm in the background. Nothing on the watch changes that. The watch shows "Sending…" at once and buzzes when the result is back (done or failed): one buzz per action, so the buzz means something.
- **Gestures** (one recording each so far, peak gyro rate and peak acceleration change): wrist flick 1521°/s and 2785; snap 49–273°/s and 93–877 over six recordings; arm wave 139°/s; finger tap 88°/s; nothing 3°/s. A wrist flick stands far apart from everything else, so it is the first gesture trigger to build; a snap overlaps ordinary movement. Per-person calibration on the watch will set the thresholds.
- **Bluetooth scan** (one scan, an office): 24 steady devices (building beacons, door readers), each seen once in a scan. Enough to fingerprint a room; home results still to come.

## Milestones

1. **M0 Spike**: measurement probes. Done.
2. **M1 One lamp**: pairing, side service, entity sync, paint, button trigger, haptic acknowledgement. Built; home test pending.
3. **M2 Whole room**: classifier, aim states, corrections, the HA component, paint backup, aim traces, replaying them (`tools/replay.mjs`) and regression tests from real paints. Built.
4. **M3 Whole house**: room fingerprints, gestures, lock confirmation, dimming, management in Home Assistant. Built; home test pending.
5. **M4 Ship it**: polish, battery (Point notes the battery level when it opens and closes; `tools/replay.mjs` turns that into % per hour of pointing), other round Zepp watches (builds cover every round screen; untested), first release.
