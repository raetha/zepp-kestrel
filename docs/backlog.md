# Backlog

Ideas and work deliberately left for later, with what's known so far. Pick from here when planning a release.

## Battery

With Detailed diagnostics on, Point notes the battery level as it opens and closes, and `tools/replay.mjs` turns that into % per hour of pointing. Once there's a week of real numbers, candidates if pointing costs too much:

- **Gyroscope off when it isn't needed**: it's the hungriest motion sensor. Only the wrist flick needs it; stillness can come from the accelerometer (already the fallback on watches without one, `tiltBetween()`). Changes how steady aim feels: test on the watch first.
- **Darker "locked" colour**: on an AMOLED screen, a full bright green screen draws more than a dark one. It's on only while locked, and was chosen to be seen at arm's length.
- **Room checks while pointing**: a 3 s Bluetooth scan every 60 s (only with rooms calibrated on the watch). Could skip while the arm hasn't been lowered since a clear match.

Already done: sensors and the aim loop run only while Point or Paint is open; the screen goes off as usual when the wrist drops; buzzes cut to two per action; diagnostics data isn't even sent unless asked for; syncs and saves send only what changed.

## Pointing and rooms: waiting on detailed diagnostics

Detailed diagnostics now record what's needed to decide these (`docs/design.md` → aim traces):

- **Steadier heading: gyro + compass.** The compass updates about 4 times a second and was 7–12° out between visits. The gyro (25 Hz) is smooth and quick but drifts; a complementary filter (gyro for short-term turns, compass for the long-term direction) would smooth and speed up the heading, but can't fix an offset the compass has for minutes. Zepp OS gives apps only the fused compass angle and whether it's calibrated, no raw magnetometer. Traces now carry `yaw` (the integrated gyro turn) next to the compass heading: check how they differ while the arm is still and while it moves.
- **Compass or standing place?** The same device read 12° apart from "the same spot". A metre to the side changes the bearing to a light 3 m away by about 18°, so some of that may be where you stood. Missed-aim traces with steps since opening tell the two apart.
- **Keep the room while you haven't walked.** Step count since the last clear room match: no steps, same room, no scan needed (faster, and saves the 3 s scan every minute). Traces now carry steps per room check.
- **Room probabilities instead of a pick.** Weight other rooms' spots by how well each room matched instead of all-or-half. A probability model was right more often in one home's held-out scans (12 of 18 against a few) but also confidently wrong more often; retest after recalibrating with Bermuda's proxies in place.
- **Floors from the barometer.** Relative air pressure tells floors apart within minutes, but weather moves it by several metres' worth over hours: it would need a reference (a pressure sensor in Home Assistant).

## Before the first release: more watches

The emulator sweep (docs/development.md → "Checking other watch models"; results in `watch/models.json` and the README table) found every model on Zepp OS 4 or later working. Worth doing before the first release:

- **Zepp OS 3.x watches** (Falcon, Cheetah round, square and Pro, T-Rex Ultra, Active). Their firmware crashes the whole watch when a screen calls one of the app's `async` functions. The fix changes form, not features: the same steps in the same order, so these watches would get the full app, limited only by their hardware (the Active has no gyroscope: no wrist flick, slightly less steady aim).
  1. First try having the build convert `async`/`await` into something the older firmware accepts, so the source stays as it is. Test on the Falcon image (about half an hour).
  2. If that crashes too, rewrite the `async` functions as promise chains (about a dozen files in `watch/page/`; the phone side, `watch/lib/ha-client.js`, runs in the Zepp app and is unaffected).
  3. Rerun the sweep on the six models: other problems may be hiding behind this crash. Update `watch/models.json`, then `python3 tools/models_table.py`.
  4. Some of these watches may have had a Zepp OS 4 update since; if so they may already work.
- **Cheetah 2 Ultra** (Zepp OS 5): Zeus builds no package for the device IDs Zepp's docs give it (9961728, 9961729). The Balance 3's package (round 480, ZPS) also carries IDs no listed model claims (9978112, 9978113, 10486016–10486019, 11092224, 11092225); one may be the Ultra. Needs an emulator image or an owner to confirm.
- **Not yet run in the emulator** (no usable image): Balance Ultra, Cheetah 2 Pro, T-Rex 3 Pro 48 mm. Each shares a package with a model that ran; rerun the sweep when Zepp publishes images.
- **Sensors** marked "not confirmed" in the table: check the manufacturer's specifications.
- **Store submission**: pick only the supported models when uploading the `.zab`.
