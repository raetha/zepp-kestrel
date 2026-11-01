# Developing Kestrel

This is the canonical guide for the repository. Read it before changing anything. The working model (branches, test builds, release pull requests) follows [raetha/zepp-watch-faces](https://github.com/raetha/zepp-watch-faces).

## Layout

| Path | What it is |
| --- | --- |
| `watch/` | The Zepp OS mini program (Zeus CLI project): watch app, side service, settings page. |
| `watch/app.json` | Manifest: app ID 1132466, version, permissions (accelerometer, gyroscope, compass, BLE, device info, step count), API level. |
| `watch/page/` | Watch screens (`home.js`, `point.js`, `paint.js`, `pair.js`, `rooms.js`, `more.js`, `gesture.js`; `probes.js` and `test.js` host the M0 probes in `probes/`) and their helpers: `ui.js` (widgets, `ask()` to the phone), `store.js` and `kv.js` (storage), `sync.js`, `trail.js`, `sensors.js`. |
| `watch/lib/` | The app's pure-JS logic, unit-tested in Node: aim maths and the classifier, gestures, rooms from Bluetooth, sync, the watch ↔ phone protocol and the Home Assistant requests (`ha-api.js`), the phone side's transport (`ha-client.js`). No `@zos/*` imports. |
| `watch/app-side/` | Side service, running in the Zepp phone app: finds Home Assistant, pairs, and relays the watch's requests. Its behaviour is in `lib/side.js` (with `lib/ha-client.js`), tested in Node; `index.js` only hands it to ZML. Keep it minimal ("The phone side doesn't update on an iPhone"). |
| `watch/setting/` | Settings page in the Zepp phone app (preview and store installs only). |
| `watch/test/` | `node --test` suites for `watch/lib/`. |
| `watch/docs/` | Install QR code and emulator screenshots. |
| `watch/CHANGELOG.md` | The watch app's version history; its sections become release notes. |
| `custom_components/kestrel/` | The Home Assistant component (MIT): the watch API (`http.py`), paired watches and their devices (`watches.py`), targets and service mapping (`targets.py`), config flow, diagnostics, and `quality_scale.yaml` (the status of every quality-scale rule). At the repo root because HACS expects it there. |
| `ha/` | The component's tests (`ha/tests/`, pytest against a real HA core), `CHANGELOG.md`, `requirements_test.txt` and `DRAFT`. |
| `hacs.json` | HACS metadata for installing the component as a custom repository. |
| `tools/` | Packaging, release and site helpers, diagnostics replay (`replay.mjs`), `emu/` (the emulator) and `compat/` (a sweep over watch models' emulator images). |
| `docs/` | This guide, `design.md`, `audits.md`, `backlog.md` and `store.md` (Zepp store submission). |
| `PRIVACY.md` | The privacy statement (README and the Zepp store). |
| `watch/docs/store/` | The Zepp store listing (`listing.md`), icon and screenshots (`tools/store/`). |

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

**Options-flow menu titles take no placeholders.** Home Assistant's frontend fills `{placeholders}` in a menu's description and its options, but not in an options-flow menu step's title: a title of `{watch}` showed "Translation [formatjs Error: MISSING_VALUE…]" on a real install, though the flow passed the value (and tests can't see it). Keep titles plain.

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

1. On `dev`, for each component being released: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (with a fresh empty `## [Unreleased]` above it) and set the version (`watch/app.json`: `version.name` = `X.Y.Z`, `version.code` + 1; and `watch/lib/version.js` to the same `X.Y.Z`, which `npm test` checks; `custom_components/kestrel/manifest.json`: `version`). For the first release, also delete `watch/DRAFT` and `ha/DRAFT`; both changelogs' `[Unreleased]` sections are already written as first-release notes. Check the notes as they'll appear: `python3 tools/release_notes.py watch X.Y.Z` (and `ha`).
2. Open a pull request from `dev` into `main`, titled with what it releases ("Kestrel 0.2.0"). The description is the new changelog sections.
3. The owner squash-merges it, keeping the title as the commit message and the changelog sections as its body.
4. CI on `main` creates each release (tag `watch-vX.Y.Z` with the `.zpk`, `.zab` and per-watch packages attached; `ha-vX.Y.Z` for the integration, which HACS offers), then resets `dev` to `main` (the `sync-dev` job) if `dev` has no newer work. If it does, reset by hand once that work is released: `git checkout dev && git reset --hard origin/main && git push --force-with-lease`.

5. Submit the watch release's `.zab` to the Zepp store: [docs/store.md](store.md) (the listing text, images, permissions and privacy statement are ready in `watch/docs/store/`).

Where the changelogs show up: each GitHub release's notes are its changelog section plus install steps (`tools/release_notes.py`), and HACS shows those for the integration; the install page shows the latest watch release's section ("What's new"); the test-build page and the integration's dev pre-releases show the `[Unreleased]` sections; the store's update notes are copied from the release notes by hand.

Versions follow [Semantic Versioning](https://semver.org/).

**Compatibility between the watch app and the integration.** Until the first release, the two only need to work at the same build: no shims for older test builds. From the first release on, each side should keep working with the other side's last two releases, with the newer features simply missing:
- Add, don't change: new endpoints, new message methods and new optional fields; keep old ones until no supported release uses them, and say in a comment which release that is.
- Every reader ignores fields it doesn't know (Home Assistant's `clean_*` in `watchdata.py` already does) and copes with missing ones (a default).
- A watch method the phone side doesn't know comes back as "unknown method" (the watch reads it as "phone runs another build"); an endpoint Home Assistant doesn't have comes back as 404: treat both as "not supported here" where a feature is optional.
- Both halves report their build (Phone app version sensor; `watch/lib/version.js`), and `InfoView` reports the integration's version: when a feature needs a minimum version on the other side, check it rather than guess.
- Test it: before a release, install the previous two releases of each side against the new one (the emulator for the watch; an older `ha-v…` HACS release for Home Assistant).

(A test build of the watch app with an older test build of the integration happened to work in October 2026; there's no guarantee of that before the first release.)

Repository settings (owner, one time):

- **Settings → Pages → Source: GitHub Actions.** Without this the deploy step fails and no test build is published.
- **Settings → Environments → github-pages → Deployment branches and tags**: add `dev` next to `main`. By default only `main` may deploy, so test builds from `dev` fail with "Branch "dev" is not allowed to deploy to github-pages due to environment protection rules".
- **Settings → Branches**: add a rule for `main` requiring a pull request before merging.
- **Settings → General → Pull Requests**: allow only squash merging.

### What CI does

`.github/workflows/build.yml`:

- **Every push and pull request:** `tools/release_plan.py` (fails if a non-draft component's version has no changelog section), `npm test`, a Zeus build of the watch app, the HA component's tests with at least 95% coverage (`ha-tests`, Python 3.14), and `validate`: Home Assistant's hassfest and the HACS repository checks.
- **On `main`, for each component whose `<component>-vX.Y.Z` tag doesn't exist yet:** creates the tag and a GitHub release, with notes from the changelog plus install instructions (`tools/release_notes.py`). The integration's dev pre-releases (each push to `dev`) carry the changelog's `[Unreleased]` section.
- **Every push to `main` or `dev`, and every 5 days (schedule):** builds the DEV test build from the tip of `dev` and redeploys the Pages site. The schedule runs the default branch's copy of the workflow (`dev` here) and exists to keep the preview QR code valid (`preview-check` fails the run if the upload didn't happen). The public install page only ever offers released versions.

### Test builds

Every push to `dev` (or `main`) publishes a test build on an unlisted page: **https://raetha.github.io/zepp-kestrel/dev/** (not linked from the main site, `noindex`, blocked in `robots.txt`).

- `tools/make_dev_variant.py` copies `watch/` to `watch-dev/` (ignored by git) as "Kestrel DEV": its own app ID (1134161, registered in Zepp's developer console), the version `<X.Y.Z>-dev.<run number>` (the run number is also the version code, so each build is newer), and that build stamped into `lib/version.js`.
- It installs **next to** the released app and pairs separately.
- Test builds are made for the watches in `TEST_WATCHES` (`build.yml`: the Balance 3 and 3 Ti, `zeus build -s -t`); releases build every watch.
- **Install:** the page shows a Zepp preview QR code (below). In the Zepp app: Profile → your watch → Developer Mode → + → Scan. Each push makes a new one, and a scheduled run every 5 days makes a fresh one before the last expires (7 days), so there's always one to install. A scheduled run whose upload fails (an expired Zepp login) fails, and GitHub emails the owner. Without the preview secrets, or if the upload failed, the page falls back to our own `.zpk` packages (one QR code per screen, `tools/packages.py`), which install the watch app but get no Settings page.
- Older test builds used other app IDs (a made-up 2132466 before Oct 31, 2026, and for an October experiment the release ID 1132466, shown as "Kestrel"). Each is a separate app with its own storage and pairing that no longer updates: delete it from the watch.

### The phone side doesn't update on an iPhone

**The iPhone Zepp app keeps the phone side (side service and settings page), and its storage, of the first build it installed for an app ID.** A later install updates the watch app but not the phone side. Seen with every route we have:

- our `.zpk` QR codes over an existing install (from October, builds 60 to 79);
- a Zepp preview over a preview (build 86 over 85, Oct 31): the Zepp app logged `appInstalled` and stopped the old side service, but the one it started next ran build 85's package (`appInfo.version` 85, its `packageInfo.timeStamp` that of build 85's upload), though build 86's package carried 86 on both halves;
- deleting Kestrel in Developer Mode first: the watch app came back empty, but the phone side kept its storage (pairing included) and still ran build 85;
- Zeus's bridge install (`zeus bridge` → `connect` → `install -t <watch>`, through Zepp's servers, no cable; build 90, Nov 1): it builds and uploads the same preview package and pushes it to the Zepp app instead of a QR scan, with the same result. We drove it from a temporary manual GitHub workflow (in git history: `tools/zeus_bridge.sh`).

Reinstalling the Zepp app, then installing Kestrel from a preview QR code, is the only thing that has replaced it. Still open: whether the Zepp app fetches the phone side again once a preview's `packageInfo.expiredTime` (48 hours; Zeus's packager `@zeppos/zpm` hard-codes 172800) has passed, and whether the watch or the Zepp app stop running an expired preview. Don't shorten that lifetime before knowing. Zepp's documentation and forums say nothing about any of this; a store install may behave differently (check at the first release).

What follows from it:

- **The side service is a minimal relay** (`docs/design.md` → Architecture): it finds Home Assistant, pairs, keeps the token and relays the requests the watch builds (`watch/lib/ha-api.js`). New features go on the watch and in Home Assistant, never in `watch/app-side/`. A phone side too old for a request answers "unknown method", and the watch says the phone part is outdated instead of asking to pair again.
- **Both halves report their build** (`watch/lib/version.js`): the phone side in its status reply and in an `X-Kestrel-Side` header on every request (Home Assistant's Phone app version sensor), the settings page in its Version card. The watch notes a difference in its trail as an error, with when each half's build changed (`noteBuilds()` in `page/trail.js`; `tools/replay.mjs` lists it).

**Looking at the phone side.** The Zepp app's Developer Mode → App log keeps only the last minute or two: open it right after an install, or right after opening Kestrel on the watch. The side service logs "Kestrel side service <build> started"; `schedule` lines (`processInfo list`) show the running side services with their start times; `postAppInfo` shows the package's `appInfo`. **The log also holds each app's stored settings, Kestrel's pairing token among them**: never post it publicly. Zeus's bridge prints the same log once connected, so never run `zeus bridge` where its output is public (the first bridge run published the token in this repository's Actions log until the logs were deleted). After a confused state, the Zepp app once refused a Developer Mode reinstall with "error 12" (`LightAppStoreDeveloperModule.DeveloperMode-Error`) and left the watch without a phone side ("Phone not reachable"); reinstalling the Zepp app cleared it.

### The Settings page

Only store installs and installs from a **real `zeus preview`** QR code get the Settings page (Developer Mode → Kestrel DEV → Settings). Our own `.zpk` QR codes never did, under any app ID, and neither did our earlier copy of Zeus's upload request (`tools/zepp_preview.py`, in git history), which sent a normal all-watch build cut down to one package with the whole build's intermediate products. Real `zeus preview` builds in preview mode for the chosen watches, without intermediate products (`ip = mode === PROD` in Zeus's `buildSupportV3Config`; Zepp's server refused our cut-down bundle without them, HTTP 500). Lifto Companion (PreciselyWrong/Liftosaur-ZeppOs-Companion) and NavGo, whose testers get the Settings page, install the same way. The package format itself wasn't the difference: Lifto's Balance 3 package and ours had the same layout and `app.json` fields. It first worked on Oct 31, 2026 (build 82).

The Zepp app's `Select` shows no value in its field: put the current choice in its label (`choice()` in `watch/setting/index.js`), and use string option values. The watch doesn't depend on the Settings page: it pairs with the Home Assistant component (`docs/design.md` → "Pairing"), and the page only mirrors and changes the watch's settings.

### Preview uploads from CI

CI uploads each `dev` build to Zepp's preview service with the real `zeus preview -s -t "<TEST_WATCHES>"`, through the `preview` action of [raetha/zepp-devkit](https://github.com/raetha/zepp-devkit) (pinned to a commit in `build.yml`; Dependabot proposes updates). The devkit's README explains what it does and why, and how to get the Zepp login: three repository secrets, `ZEPP_APPTOKEN`, `ZEPP_USERID` and `ZEPP_CNAME`, the same in every repository that uses the devkit (when the login expires, update them all). Without them the upload is skipped and the test page shows our own QR codes; a failed or expired login is a warning on a push's run, and fails a scheduled run (`preview-check`), so the expiry gets noticed. Treat the token like a password: never paste it into a chat or a sandbox.

The release QR code (`watch/docs/install-qr.png`) encodes `zpkd1://raetha.github.io/zepp-kestrel/watch/kestrel.zpk`. Regenerate with `npm run qr` if the repo moves.

## Audits

Quality scale, performance and security reviews are in [audits.md](audits.md), which starts with the checklist for a full review: open pull requests (Dependabot's included), security alerts, tests, the quality scale, the security design, workflows and leftovers. Repeat it before each release.

## Licensing

MIT for everything (`LICENSE`), like Home Assistant and most of its ecosystem: anyone may use, change and share the code, commercially too. Forks are asked (README) to use another name and icon. Until 2026-10 the watch app was CC BY-NC-SA 4.0, with generic helpers in a separate MIT `lib/`; that split is gone and the helpers live in `watch/lib/`.

## Packaging for delivery

Sessions normally commit and push. When a session has only read access, deliver the repo as a zip instead:

```bash
zip -r zepp-kestrel.zip . -x ".git/*" "node_modules/*" "*/dist/*" "tools/.emu*/*" "*/__pycache__/*" "site/*" "out/*" "out-dev/*" "watch-dev/*"
```
