# Developing Kestrel

This is the canonical guide for the repository. Read it before changing anything. The working model (branches, test builds, release pull requests) follows [raetha/zepp-watch-faces](https://github.com/raetha/zepp-watch-faces).

## Layout

| Path | What it is |
| --- | --- |
| `watch/` | The Zepp OS mini program (Zeus CLI project): watch app, side service, settings page. |
| `watch/app.json` | Manifest: app ID 1132466, version, permissions (accelerometer, gyroscope, compass, BLE), API level. |
| `watch/page/` | Watch screens. M0: `menu.js` and `test.js` (hosts one probe from `probes/`). `sensors.js` wraps `@zos/sensor`; `ui.js` has the widget helpers. |
| `watch/lib/` | The app's pure-JS logic, unit-tested in Node: aim maths, spike (gesture) analysis, BLE aggregation for rooms, watch ↔ phone protocol. No `@zos/*` imports. |
| `watch/app-side/` | Side service, running in the Zepp phone app: answers the watch and talks to Home Assistant (`ha.js`). |
| `watch/setting/` | Settings page in the Zepp phone app. |
| `watch/test/` | `node --test` suites for `watch/lib/`. |
| `watch/docs/` | Install QR code and emulator screenshots. |
| `watch/CHANGELOG.md` | The watch app's version history; its sections become release notes. |
| `custom_components/kestrel/` | The Home Assistant component (MIT): the watch API (`http.py`), paired watches and their devices (`watches.py`), targets and service mapping (`targets.py`), config flow, diagnostics, and `quality_scale.yaml` (the status of every quality-scale rule). At the repo root because HACS expects it there. |
| `ha/` | The component's tests (`ha/tests/`, pytest against a real HA core), `CHANGELOG.md`, `requirements_test.txt` and `DRAFT`. |
| `hacs.json` | HACS metadata for installing the component as a custom repository. |
| `tools/` | Packaging, release and site helpers, and `emu/` (the emulator). |
| `docs/` | This guide and `design.md`. |

## One-time setup

```bash
npm install                                  # @zeppos/zml, device types, ws
pip install -r tools/requirements.txt        # pillow, qrcode
npm install -g @zeppos/zeus-cli@1.9.3        # builds the watch app

# the HA component's tests need Python 3.14
uv venv .venv --python 3.14
uv pip install --python .venv/bin/python -r ha/requirements_test.txt
```

## Everyday loop

1. Change code in `watch/`. Keep logic that doesn't need the Zepp runtime in `watch/lib/` (or `lib/` if it is generic, see "Licensing") with tests.
2. `npm test`, and for component changes `cd ha && ../.venv/bin/pytest -q`.
3. `npm run build` (or `cd watch && zeus build`) to check it compiles.
4. Run it on the emulator (below): open the screens you changed, look at screenshots, and check `tools/.emu/serial.log` for `Mini Program Error`.
5. Push to `dev` and test on the watch from the test-build page.

### Checking other watch models

`python3 tools/compat/make_variant.py`, `(cd watch-compat && zeus build)`, then `node tools/compat/sweep.mjs [model ...]` runs the app on each model's emulator image that Zeus builds a package for (Zepp publishes images for about 30 models). Each model gets its firmware downloaded into `tools/.emu-m/<model>/` (deleted afterwards), the package for its screen installed, and the app opened from the app list; `watch-compat` then logs what the firmware offers (`KCOMPAT cap ...`: sensors start, display and Bluetooth APIs) and walks itself through Home, Point, Paint and More. Results and screenshots land in `tools/compat/out/` (not committed). About 10–25 minutes per model, unattended. The emulator feeds made-up sensor data on every model, so whether a watch really has a compass or gyroscope comes from its specifications. Record the outcome in `watch/models.json`, then run `python3 tools/models_table.py` (the README table; CI checks it's current). The install pages' watch picker lists the models from it that aren't `unsupported`. A model marked `tested` or `emulator` needn't be checked again; `untested` ones (no usable emulator image) and `unsupported` ones are worth another look when Zepp publishes new images or firmware.

What the first sweep (2026-10-24) found: every model on Zepp OS 4 or later ran through all four screens. Every model whose image is Zepp OS 3.x (API 3.6: Falcon, Cheetah round, square and Pro, T-Rex Ultra, Active) crashed the whole watch (`configASSERT` in the firmware log) the moment a screen called one of the app's `async` functions: Paint's room lookup, Point's sync, whichever ran first. Home has none, so it worked. Narrowed down on the Falcon by moving calls around and logging each step: not the sensors, files, buttons, battery or requests. Making those watches work would mean writing the app without `async`/`await`; they're documented as unsupported instead. Zeus can't leave them out of the build: it builds per screen and chip, and the Balance (Zepp OS 4) shares a package with the Cheetah Pro. When submitting the `.zab` to the store, choose only the supported models.

Older firmware (Zepp OS 3.x) gives itself a fixed address (192.168.166.188) instead of taking QEMU's; `emu.mjs start` notices and restarts with the port forwarded there.

### Packages per watch

A QR install sends one `.zpk`, and the Zepp app can't install a `.zab`, so CI splits the build into one package per screen and chip (`tools/packages.py`, with `packages.json` listing the device IDs each is for). The install pages list the models from `watch/models.json` and show the QR code of the package for the one picked (`tools/model_picker.py`). The `.zab` itself is what the Zepp store takes: releases attach it (`kestrel-<version>.zab`, the one to submit), and the test page links the DEV one.

### Replaying diagnostics

`node tools/replay.mjs <diagnostics.json>` (the integration's diagnostics download) runs the current `watch/lib` against what a real watch recorded: each room calibration scan against all rooms, rooms that sound alike, each paint and what crowds it, each trigger's aim trace through the Aimer (which device it would pick today, its lead, and how long it took to lock then and now), aims held out that never triggered, Paint sweeps (readings and the biggest heading jump), learned spots, and battery use per hour of pointing. In Home Assistant, each watch's Paint map image shows the same paints as compass dials per room. Use it before and after changing the classifier or room matching; turn a case worth keeping into a test (`watch/test/m1.test.mjs` has one from a real kitchen).

## Dependencies

Prefer a maintained library over our own code; write our own when nothing maintained fits. Pin exact versions (Dependabot proposes updates weekly). Everything bundled into the watch app runs in Zepp's QuickJS and counts against the package size, so check the bundled size too.

| Need | Choice | Why |
| --- | --- | --- |
| Watch ↔ phone messaging, side-service HTTP | `@zeppos/zml` | Zepp's official library. |
| Mean, median, quantiles, standard deviation | `simple-statistics` (ISC) | Maintained; about 3.4 KB bundled for what we use. `watch/lib/stats.js` wraps it. |
| Circular statistics (compass headings) | Our own `watch/lib/circular.js` | `angles` (MIT, maintained) has normalising, distances and a plain average, but no weighted mean and no spread measure, which the paint model needs; it also keeps a global scale setting. |
| Pitch and roll from gravity | Our own `watch/lib/aim.js` | Two textbook formulas. Sensor-fusion libraries (for example `ahrs`, unmaintained since 2023) need raw magnetometer readings, which Zepp OS doesn't expose (the compass API gives only a heading). |
| Snap / tap / flick detection | Our own `watch/lib/spike.js` | Nothing maintained exists for this; it will be tuned on our own recordings. |
| Bluetooth scanning | Zepp's `@zos/ble` directly | We only scan and read signal strength. `@silver-zepp/easy-ble` (MIT, last published 2024) helps with connecting to devices, which we don't do. |
| Storing paint data (M2) | To decide | Candidates: Zepp's built-in storage, or `@silver-zepp/easy-storage` (MIT, published 2025). |

## The Home Assistant component and the quality scale

We aim for the [integration quality scale](https://developers.home-assistant.io/docs/core/integration-quality-scale/) as we go, so the final compliance check finds little to change. `custom_components/kestrel/quality_scale.yaml` lists every rule as done, todo or exempt (with the reason); update it in the same change as the code. Rules that shape everyday code:

- State lives on the config entry (`entry.runtime_data`, typed `KestrelConfigEntry`), never in `hass.data`. The HTTP views find it with `hass.config_entries.async_loaded_entries(DOMAIN)`.
- Each paired watch is a device (`identifiers={(DOMAIN, watch_id)}`); deleting it unpairs the watch (`async_remove_config_entry_device`), and setup removes devices of watches that are gone.
- Tests run with HA's deprecation checks, which raise on deprecated APIs (for example `async_get_device` and `DeviceEntry.config_entries`, replaced in 2026 by `async_get_device_by_identifier` and `config_entry_id`). Fix them rather than silencing them.
- Coverage stays at or above 95% (CI fails below).
- Strings live in `strings.json`, copied to `translations/en.json` (custom integrations load translations from there).
- The manifest has no `categories` yet, so HACS validation warns about it. The hassfest image CI runs (the latest stable HA, 2026.10) rejects the key; HA's development branch accepts it. Once a stable HA release accepts it, add `"categories": ["buttons_remotes"]` (allowed values: https://contributors.home-assistant.io/core/integrations/categories/).

## Testing on the emulator

`tools/emu/emu.mjs` runs the app on the real Zepp OS firmware, headless, using the QEMU emulator that ships with Zepp's simulator. The image is the Amazfit Balance 2 (480×480 round, Zepp OS 5, API 4.2), the closest Zepp publishes to the Balance 3.

One-time setup (Linux x86_64, about 5 minutes, about 240 MB from Zepp's CDN into `tools/.emu/`, which isn't committed):

```bash
apt-get update && apt-get install -y libvte-2.91-0 libaio1t64 xvfb xdotool
node tools/emu/emu.mjs setup
node tools/emu/emu.mjs start                  # boots in about 40 s
```

Everyday commands (`npm run emu -- <command>` works too):

```bash
node tools/emu/emu.mjs install watch          # zeus build + install (or watch-dev for a test build)
node tools/emu/emu.mjs apps                   # open the app list
node tools/emu/emu.mjs tap 240 362            # Kestrel's row (below Settings on a fresh watch)
node tools/emu/emu.mjs tap 240 148            # tap anything; long-press: tap x y 2.5
node tools/emu/emu.mjs swipe 5 240 300 240    # back
node tools/emu/emu.mjs key backspace          # lower button
node tools/emu/emu.mjs shot out.png           # 480x480 screenshot
node tools/emu/emu.mjs stop
```

What the emulator can and can't tell you:

- **It shows** real widget layout and text, page navigation, permission checks, and JavaScript errors (in `tools/.emu/serial.log`).
- **No phone.** The side service and settings page don't run, so every watch → phone request fails. The probes show "Phone not reachable"; that's the expected result.
- **Sensors are synthetic.** Accelerometer and gyro report about 25 Hz in every frequency mode, the compass wanders, and Bluetooth scans find nothing. Measure on the watch.
- **Startup log line.** Every launch logs `Mini Program Error TypeError: cannot set property 'exports' of undefined` from `app.js`, after ZML's `BaseApp` has registered the app. Everything keeps working. Check whether the real watch logs it too.
- `zeus build` converts images to the watch's compressed format, which the emulator can't decode. `tools/emu/prepare.py` swaps the original PNGs back in for the emulator only.

### Zeus behind a proxy

Zeus CLI 1.9.3 bundles axios 1.8, which sends plain-HTTP requests to an HTTPS proxy and fails with a 405. Upgrade it inside the global install:

```bash
cd "$(npm root -g)/@zeppos/zeus-cli" && npm i axios@latest --no-save
```

## Branches and releases

`main` holds releases only: each commit on it is one release, squash-merged from a pull request, so its history reads release by release. Day-to-day work happens on other branches.

| Branch | What goes there | What a push does |
| --- | --- | --- |
| `main` | One squash-merged commit per release. Never pushed to directly. | Releases every component whose version has no tag yet, and rebuilds the install site. |
| `dev` | Work that's been adopted, ready for the next release. The changelogs' `## [Unreleased]` sections are kept up to date here. | Publishes the DEV test build on the [test-build page](https://raetha.github.io/zepp-kestrel/dev/). |
| `try/<topic>` | Experiments that may be dropped. Branched from `dev`. | CI checks only (tests and Zeus build). |

Day to day:

1. Small, settled changes go straight onto `dev`.
2. Anything exploratory starts on `try/<topic>`. If it's adopted, squash-merge it into `dev` (one commit with a clear message) and delete the branch. If not, delete the branch and note the idea in `docs/design.md`.
3. Each adopted change adds a line under `## [Unreleased]` in the affected component's `CHANGELOG.md`, written for someone installing it.
4. Test on the watch from the test-build page after each push to `dev`.

Releasing (only when the owner asks):

1. On `dev`, for each component being released: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (with a fresh empty `## [Unreleased]` above it) and set the version (`watch/app.json`: `version.name` = `X.Y.Z`, `version.code` + 1). For the first watch release, also delete `watch/DRAFT`.
2. Open a pull request from `dev` into `main`, titled with what it releases ("Kestrel 0.2.0"). The description is the new changelog sections.
3. The owner squash-merges it, keeping the title as the commit message and the changelog sections as its body.
4. CI on `main` creates each release (tag `watch-vX.Y.Z`, with the `.zpk` and `.zab` attached), then resets `dev` to `main` (the `sync-dev` job) if `dev` has no newer work. If it does, reset by hand once that work is released: `git checkout dev && git reset --hard origin/main && git push --force-with-lease`.

Versions follow [Semantic Versioning](https://semver.org/).

Repository settings (owner, one time):

- **Settings → Pages → Source: GitHub Actions.** Without this the deploy step fails and no test build is published.
- **Settings → Environments → github-pages → Deployment branches and tags**: add `dev` next to `main`. By default only `main` may deploy, so test builds from `dev` fail with "Branch "dev" is not allowed to deploy to github-pages due to environment protection rules".
- **Settings → Branches**: add a rule for `main` requiring a pull request before merging.
- **Settings → General → Pull Requests**: allow only squash merging.

### What CI does

`.github/workflows/build.yml`:

- **Every push and pull request:** `tools/release_plan.py` (fails if a non-draft component's version has no changelog section), `npm test`, a Zeus build of the watch app, the HA component's tests with at least 95% coverage (`ha-tests`, Python 3.14), and `validate`: Home Assistant's hassfest and the HACS repository checks.
- **On `main`, for each component whose `<component>-vX.Y.Z` tag doesn't exist yet:** creates the tag and a GitHub release, with notes from the changelog plus install instructions.
- **Every push to `main` or `dev`:** builds the DEV test build from the tip of `dev` and redeploys the Pages site. The public install page only ever offers released versions.

### Test builds

Every push to `dev` (or `main`) publishes a test build on an unlisted page: **https://raetha.github.io/zepp-kestrel/dev/** (not linked from the main site, `noindex`, blocked in `robots.txt`).

- `tools/make_dev_variant.py` copies `watch/` to `watch-dev/` (ignored by git) with its own app ID (release ID + 1,000,000 = 2132466), the name "Kestrel DEV" and the version `<X.Y.Z>-dev.<run number>`.
- It installs **next to** the released app. Its settings in the Zepp app are separate, so enter the HA URL and token for it once.
- Its QR code (`zpkd1://raetha.github.io/zepp-kestrel/dev/watch/kestrel.zpk`) never changes: bookmark the page and rescan after each push. The Zepp app shows the build number. GitHub Pages can cache files for up to 10 minutes.

### Preview installs and the Settings page

**On the iPhone Zepp app, sideloaded apps get no Settings page.** Only apps installed from the Zepp store appear under Device → Device App Settings. We tried our own `.zpk` QR code, a `.zab` QR code (the Zepp app can't parse it), and uploads to Zepp's own preview service exactly as `zeus preview` does (one package, intermediate products included), under both the test and the registered app ID: the app installs and its side service runs, but no Settings entry appears and the Developer Mode → Mini Program list stays empty. Store apps built the same way do get one: Zepp2Hass (MrCodeEU/zepp2hass-watch) has the same `setting` module in `app.json` and the same `AppSettingsPage` code, and is installed from the store. So the watch doesn't depend on the Settings page: it pairs with the Home Assistant component (see `docs/design.md` → "Pairing").

Since the preview service gave nothing the plain `.zpk` doesn't, CI no longer uploads to it: the test-build page has one QR code, for our own `.zpk`, which never expires and always installs the newest build. (The upload tool, `tools/zepp_preview.py`, is in the git history if the store route ever needs it; it used the owner's Zepp developer login, which no longer needs to be kept as repository secrets.)

Test builds install only as "Kestrel DEV" (app ID 2132466). An earlier experiment also offered the build under the registered app ID 1132466 (shown as "Kestrel"); it showed no Settings page either and was removed. Uninstall a leftover "Kestrel" test install from the watch: it has its own storage and pairing and no longer updates.

The release QR code (`watch/docs/install-qr.png`) encodes `zpkd1://raetha.github.io/zepp-kestrel/watch/kestrel.zpk`. Regenerate with `npm run qr` if the repo moves.

## Audits

Quality scale, performance and security reviews are in [audits.md](audits.md). Repeat them before each release.

## Licensing

MIT for everything (`LICENSE`), like Home Assistant and most of its ecosystem: anyone may use, change and share the code, commercially too. Forks are asked (README) to use another name and icon. Until 2026-10 the watch app was CC BY-NC-SA 4.0, with generic helpers in a separate MIT `lib/`; that split is gone and the helpers live in `watch/lib/`.

## Packaging for delivery

Sessions normally commit and push. When a session has only read access, deliver the repo as a zip instead:

```bash
zip -r zepp-kestrel.zip . -x ".git/*" "node_modules/*" "*/dist/*" "tools/.emu*/*" "*/__pycache__/*" "site/*" "out/*" "out-dev/*" "watch-dev/*"
```
