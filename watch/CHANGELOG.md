# Changelog

All notable changes to the Kestrel watch app. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Compass tilt probe: a Turn recording (ahead, left, right, ahead again), and the gyro's turn recorded at its full rate, to test steadying the compass with the gyro.
- Pairing again, or pairing a new watch, offers the setups Home Assistant already has (another watch's, or one removed in the last 30 days): pick one to take over its paints, rooms and settings instead of starting from nothing.
- Screen time: Kestrel's screens stay on 30 s without a touch, whatever the watch's own timeout (More → Screen: 10, 20, 30 or 60 s; any 5–120 s in Home Assistant and the Zepp app's settings page).
- The compass tilt probe calibrates the compass itself (turn the watch in a circle until the dots go green), then shows the steps again for you to press Record, instead of sending you to the Compass app.
- The watch and its part in the Zepp app now report their builds: the home screen says when they differ, and the watch notes when that began, so it shows up in the diagnostics even without Detailed diagnostics.
- When the Zepp app on the phone is running a different Kestrel build than the watch (seen after a test-build install), Home and Pair say so and suggest force-quitting the Zepp app, instead of asking you to pair again.
- More for tuning with Detailed diagnostics on (nothing extra is measured or sent with it off): aims held out that never triggered, the score, lead, gyro and compass state in each aim trace, the room checks made while pointing, steps taken since Point opened (not your step count), and the readings of each Paint sweep. The app asks for step data for this; deny it and only the step counts are missing.
- Faster, steadier locking on a device that has nothing else painted near it: when the compass reads well off from where you painted (it often drifts 7–12° between visits), Point still locks instead of staying amber until you move. Instant toggle still needs an ordinary lock.
- Rooms: a Bluetooth scan has to match a room better before the watch believes it, so a room you haven't calibrated is no longer taken for the one that sounds most like it.
- Dim without holding: once a dimmable light (or a media player's volume) is locked, slowly roll your wrist and Point switches to the dimmer; hold still for a second and it's sent. Holding the button or screen while twisting still works.
- When the watch is sure which room you're in, devices painted only in other rooms can't be picked any more, so a light in the next room never wins through a wall or doorway. When it only just placed you, the room name shows a "?" and other rooms' devices count half as before.
- Install pages (test builds and releases) list the watch models and show the QR code for the package built for the one you pick; releases also attach every package and the store bundle (`.zab`).
- The README lists which watches Kestrel works on, from running it on each model's emulator image. Watches still on Zepp OS 3.x (Falcon, Cheetah, Cheetah Pro, T-Rex Ultra, Active) aren't supported: their firmware crashes running the app.
- Open on Point: start the app straight on Point (More → Open on), so assigning Kestrel to the watch's shortcut button goes straight to pointing. Back goes to the home screen. Also in Home Assistant and the Zepp app's settings page.
- Twist volume: hold and twist at a media player to change its volume, like dimming a light. Home Assistant keeps it safe: one twist changes it by at most 20%, twists are at least a second apart, and twisting never takes it above 80% (both limits can be changed; turning it down always works).
- Scenes, scripts and buttons as virtual spots: Paint → Scenes & more lists them, and you paint any spot you like for each (the sofa for a movie scene). Input buttons can be triggered too.
- Learning from use (on by default): triggers that locked on clearly and weren't corrected slowly refine where each device is, in up to three learned spots per device next to your paints; room calibrations follow slow changes in what Bluetooth hears.
- Square watches and more round ones: builds cover every round and square Zepp OS screen (API level 3.6+); layouts are centred on square screens. Watches without a gyroscope use the accelerometer to tell when the arm is still; watches without a compass say so.
- Paint warns when the new paint sits so close to another device's that pointing may not tell them apart, and suggests painting from where they stand further apart.
- Room calibration says when a room sounds like another one to Bluetooth (common for open-plan spaces), where the watch relies on aim alone.
- Point notes the battery level when it opens and closes (in the diagnostics), to measure battery use while pointing.
- M0 measurement build: probes for sensor rates, snap/tap/flick recordings, compass tilt, Bluetooth scans per room, and watch → phone → Home Assistant latency.
- Settings page in the Zepp app (store installs): the watch's settings and a list of probe results.
- Pairing with Home Assistant (needs the Kestrel integration): the phone finds Home Assistant on the home Wi-Fi (`homeassistant.local` on port 80 or 8123; other addresses can be typed on the watch), Home Assistant shows a 6-digit code, and you type it on the watch. Kestrel works on your home network (or a VPN into it), never through Home Assistant Cloud.
- Paint a device: pick it from the synced list, then sweep your arm across it for 15 seconds. Painting again from other places you use it improves aim. Unsteady compass readings are rejected with a hint.
- Point: hold your arm out at a painted device; the whole screen turns amber while aiming, dark green when the watch has a device in mind, and bright green when it's locked on. Press the select button or tap the screen to toggle it. Locks ask for a confirming tap (dark red). The screen flashes bright green when the action is done, red when it failed.
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
- Faster and lighter on the watch: stored data is read from flash once per screen, unchanged data isn't rewritten, the debug trail logs only button clicks, and the room is checked every 60 s while pointing.
- Instant toggle: hold the aim on a device for a few seconds to trigger it, with no button or gesture (More → Instant, or in Home Assistant). It fires once per hold; locks still need a press.
- The Zepp app's settings page (store installs) shows and changes the watch's settings: gesture, instant toggle and room source. Changes go to Home Assistant and reach the watch when it next syncs.
- A snap or tap no longer triggers twice: gestures are ignored for 3 seconds after a trigger and while the watch itself buzzes (its vibration looked like another snap).
- Each gesture (flick, snap, tap) keeps its own calibration, so switching between them, on the watch or from Home Assistant, needs no recalibrating. Point says when the chosen gesture still needs calibrating.
- Point keeps the screen on while you're pointing: every time your arm is held out, or something is triggered, the screen gets another 30 seconds. Lowering your wrist lets it go off as usual.
- When the compass needs calibrating, Paint asks you to turn the watch in a circle (as the Compass app does) and waits, instead of recording a sweep that fails; Point says the same. Dots round the edge light up as you turn the watch through each direction, and all go green, with one buzz, when the compass is calibrated. (Zepp OS tells apps only when calibration is done, not how far along it is, so the dots show your circling, not a percentage.)
- Tells Home Assistant its version, the room it placed itself in, and how each trigger happened, for the watch's sensors there.
- When Home Assistant has more devices than it sends, Sync says so ("1000 of 1240 devices"); choosing devices for watches in Home Assistant narrows the list.
- Pairing again keeps the watch's paints and room calibrations and sends them to Home Assistant.
- One QR code on the test-build page; it never expires.
- Corrections: after a trigger, "Not it?" offers the next most likely device for 5 seconds. Choosing it undoes the first where possible, toggles the right one, and teaches the watch where you aimed.
- Each trigger sends a short record of the aim to Home Assistant (in the diagnostics download), to tune pointing.
- More screen on Home: Gesture, Rooms, Probes and Unpair.
- Licence: MIT, like the rest of the project.

### Changed

- Saving a paint, a correction, a learned spot or a room calibration sends only what changed, in one message, instead of the whole list of paints or rooms after a sync round trip: much less Bluetooth traffic once many devices are painted.
- Sends aim traces, its full screen and button trail, battery levels and raw room scans to Home Assistant only while Detailed diagnostics is on there; otherwise only a trail with an error.
- Better at telling close devices apart. A device painted with a wide sweep no longer wins the space next to a tightly painted one (the watch now weighs how precisely each was painted), so both lock where you'd expect. Devices painted in another room still count, at half weight, instead of disappearing when the watch thinks it's in a different room (open-plan rooms often sound alike to Bluetooth).
- Bigger text on Point (the device name is about twice the size) and big countdown numbers in Paint, for reading at arm's length. Paint's screen turns amber while recording, green when the paint is saved and red when it wasn't.
- Fewer vibrations. Point buzzes once when it locks onto a device (not again while you stay on it) and once when the action is done or failed; no buzz when a command is sent, when dimming starts or at each 10% of dimming. Room calibration buzzes when it starts and when it's done, not at every scan, and gesture calibration dropped a buzz between steps.
- Direct mode is gone: Kestrel needs its Home Assistant integration. The phone no longer stores a Home Assistant URL or long-lived token, and the settings page no longer asks for them.
- Works on the home network only (or a VPN into it): the phone no longer keeps Home Assistant's cloud address, and says so when Home Assistant isn't reachable.
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

- Learning from use no longer drops a vote when another device is triggered within a few seconds.
- On watches without a gyroscope, readings arriving in a burst no longer stop the arm from ever counting as still.
- If the compass loses calibration again right after regaining it, the dots start counting again instead of staying green.
- Instant toggle could trigger the same device again if you kept aiming at it while a slow request was out. Point now says "Aim away to repeat" once it has fired.
- The record of screens, buttons and swipes kept only launches and exits: the app itself overwrote what the screens wrote when it closed. Launches are now noted by the home screen, and the record also says which watch model it is.
- The Compass tilt probe says when the compass needs calibrating instead of recording without headings.
- Probe results stopped reaching Home Assistant ("Not sent: undefined is not an object"): the phone now sends each result to Home Assistant before keeping a small summary for itself, clears an oversized summary list, and says which step failed if one does.
