# Notes for Claude sessions

Kestrel: point an Amazfit / Zepp OS watch at a smart-home device and trigger it, with Home Assistant. Developed on the Amazfit Balance 3 (480×480 round, API level 4.4). The canonical guide is `docs/development.md`, and the design is `docs/design.md`. Read both before changing anything. This file is the short version of what a new session needs.

## How we work

- Sessions can push to this repo. If a session has read-only access, fall back to a zip of the repo (`docs/development.md` → "Packaging for delivery").
- **Branches** (`docs/development.md` → "Branches and releases"): never push to `main`; it gets one squash-merged pull request per release. Adopted work goes on `dev`, and experiments that may be dropped go on `try/<topic>` branches off `dev`. Each push to `dev` publishes a DEV test build at https://raetha.github.io/zepp-kestrel/dev/, and the owner tests it on the watch by scanning its QR code. The owner has no local Zepp dev environment, so that page is how builds reach the watch.
- Record each adopted change under `## [Unreleased]` in the component's `CHANGELOG.md` (`watch/CHANGELOG.md`, `ha/CHANGELOG.md`), written for people installing it. Never bump a version or date a changelog without being asked: that's the release pull request (`dev` → `main`), which the owner squash-merges. CI then resets `dev` to `main` (when nothing new landed on `dev` meanwhile).
- `watch/DRAFT` and `ha/DRAFT` keep each component from being released until the owner says its first release is ready.
- Two components: the watch app (`watch/`) and the Home Assistant component (`custom_components/kestrel/`, at the repo root where HACS expects it; its tests, changelog and DRAFT are in `ha/`).
- Name: **Kestrel** (renamed from WristWand before the first release). The logo is `brand/kestrel.svg` (a kestrel diving at a target); its renders are the watch icon (`watch/assets/default.r/icon.png`, 248 px) and the Home Assistant brand images (`custom_components/kestrel/brand/`, 256 and 512 px). Storage and message keys start with `kestrel.`. It is inspired by commercial point-and-snap apps for other watches but must never use their names, code, assets or branding.
- Licence: MIT for everything (`LICENSE`), like Home Assistant's ecosystem; forks are asked to use another name and icon. All watch code is in `watch/` (generic helpers too, in `watch/lib/`).

## Validate on the real firmware

- `npm test` runs the pure-JS library tests (`watch/lib/`). Fast, but no Zepp runtime.
- HA component: keep `custom_components/kestrel/quality_scale.yaml` current with each change (`docs/development.md` → "The Home Assistant component and the quality scale"). State on `entry.runtime_data`, one device per watch, ≥95% test coverage. HA's deprecation checks fail tests on deprecated APIs: fix, don't silence.
- HA component tests run against a real HA core (Python 3.14): `uv venv .venv --python 3.14 && uv pip install --python .venv/bin/python -r ha/requirements_test.txt`, then `cd ha && ../.venv/bin/pytest -q`.
- The emulator runs the real Zepp OS firmware (Balance 2 image, API 4.2) in QEMU, headless. Use it to catch crashes and layout problems before a push. First-time setup in a fresh container (about 5 minutes, about 240 MB):

  ```bash
  apt-get update && apt-get install -y libvte-2.91-0 libaio1t64 xvfb xdotool
  pip install --break-system-packages -r tools/requirements.txt
  npm install && npm install -g @zeppos/zeus-cli@1.9.3
  node tools/emu/emu.mjs setup && node tools/emu/emu.mjs start
  ```

- Loop: `node tools/emu/emu.mjs install watch`, then `apps`, then `tap 240 362` (the app's row in the app list), then `tap`/`swipe`/`shot out.png`. Back is `swipe 5 240 300 240`. The firmware log (with `console.log`) is `tools/.emu/serial.log`.
- Network allowlist needed: `*.zepp.com` and `*.huami.com`. Zeus CLI 1.9.3 ships axios 1.8, which fails through an HTTPS-only proxy with a 405; upgrade axios inside the global zeus-cli install (`docs/development.md` → "Zeus behind a proxy").

## Hard-won facts (details in docs/development.md)

- Sideloaded apps get **no Settings page** in the iPhone Zepp app: not from our `.zpk` QR, and not from Zepp's own preview service (`zeus preview`; our upload tool for it is in git history), whatever the app ID. CI no longer uploads previews: the test page has one QR code, our `.zpk`. Only store installs appear under Device → Device App Settings. So the watch pairs with the HA component instead (phone finds HA at `homeassistant.local`, HA shows a code, the code is typed on the watch). The side service does run for sideloaded apps.
- A `.zab` holds one `.zpk` per screen and chip. `tools/extract_zpk.py` picks by device ID (Balance 3 = 11141376); a QR install must get that one.
- The emulator has no phone: the side service and settings page never run there, so watch → phone requests fail ("Phone not reachable"), which is the expected result. ZML's `request` waits up to 60 s by default: always go through `ask()` in `page/ui.js`, which sets a timeout.
- Real Balance 3 (M0 data, `docs/design.md` → "What the real watch measured"): accelerometer and gyro top out at about 25 Hz (use NORMAL; LOW delivers in bursts); the forearm is the x axis (3–9 o'clock); the compass heading is tilt-compensated, reads 90° clockwise of the forearm, and updates about 4 times a second. Use `attitude()` in `watch/lib/aim.js` for where the arm points.
- Zepp OS closes an app about 10 s after its screen goes off and wakes to the watch face; back pressed after that ends the app (trail: keys arrive, the page closes, nothing reopens). Don't hold `pauseDropWristScreenOff` for a whole page: probes (`ctx.awake`) and Paint hold it only while running; Point uses `setWakeUpRelaunch`, and renews `setPageBrightTime` (30 s) while the arm is held out or something is triggered, so lowering the wrist still lets the screen go off. Every page is wrapped in `tracked()` (`page/trail.js`), which notes screens, keys (back = 8; events 16 press, 8 release, 1 click), swipes and errors; the next launch sends that trail to Home Assistant as a `trail` probe result (in diagnostics). Physical keys go through `listenKeys()` in `page/ui.js`. Pages with async work check that they're still alive before touching widgets. `getDeviceInfo()` needs the `data:os.device.info` permission.
- Don't use LocalStorage on the watch: each page (and the app context) gets its own copy and writes it back later, so what Home's sync saved never reached Paint or Rooms, and a reinstall then lost it all (seen on the emulator and the real watch). `page/kv.js` keeps one JSON file per key with `@zos/fs`, written at once, and caches each file's text per page (pages never overlap). Pages read and write storage through `page/store.js`; `app.js` touches none.
- Home Assistant holds the master copy of each watch's paints, rooms and settings (`custom_components/kestrel/watchdata.py`, revisions per section, editable in the options flow). The watch syncs with `watch/page/sync.js` + `watch/lib/sync.js`: change locally with `setPaint`/`setRoom`/`setGesture` (marks dirty), then `syncSoon(ask, section)`. Don't write paints directly.
- Security (`docs/audits.md`): pairing only from the home network (`_from_home` in `http.py`), a watch only fires what it's offered (`is_offered`), every watch-sent value is cleaned in `watchdata.py`. Keep it that way; re-run the audits before a release.
- Phone-side settings storage (`this.settings` in `app-side/`) is small: never put raw traces or trails there, and never let a storage write fail a request. Forward to Home Assistant first.
- Every `@zos/*` API that needs a permission throws "PERMISSION DENIED <code>" at runtime without it in `app.json` (e.g. `device:os.local_storage` for `@zos/storage`). The emulator catches these.
- To check screens that need synced data on the emulator, make `watch-dev` (`tools/make_dev_variant.py`) and give `page/store.js` default targets and paints there; never commit that.
- Zepp OS cancels a page's timers when the page closes, and pages don't stay open underneath others (Home is rebuilt on the way back). ZML's phone handshake and request timeouts run on the asking page's timers, so leaving a page mid-request left the handshake pending forever and hung every later request. `ask()` in `page/ui.js` adds a backup timer and resets a handshake stuck past 5.5 s: always go through it.
- The watch's own vibration jolts the accelerometer enough to look like a snap or tap: `haptics.onBuzz()` lets gesture detection ignore it (`GestureDetector.quiet()`), and Point ignores gestures for 3 s after each trigger.
- The emulator feeds synthetic motion at about 25 Hz in every frequency mode and a wandering compass. Its sensor numbers say nothing about the real watch.
- On every launch the emulator log shows `Mini Program Error TypeError: cannot set property 'exports' of undefined` from `app.js`. It comes after ZML's `BaseApp` has registered the app and doesn't stop anything working; watch for it on the real watch.
- `watch/lib/` must stay free of `@zos/*` imports so Node can test it (`watch/test/`); its `package.json` sets `"type": "module"`. Pages import it by relative path; Zeus bundles it.
- Dependencies live in the root `package.json`; Zeus resolves them from `watch/` and `watch-dev/` by walking up.
