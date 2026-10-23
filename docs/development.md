# Developing WristWand

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
| `lib/` | Generic helpers with no tie to watches (MIT): circular statistics, summary statistics, a rate meter. Tests in `lib/test/`. Watch code imports them by relative path. |
| `watch/docs/` | Install QR code and emulator screenshots. |
| `watch/CHANGELOG.md` | The watch app's version history; its sections become release notes. |
| `custom_components/wristwand/` | The Home Assistant component (MIT): pairing, the target list and actions for watches (`http.py`), paired watches (`watches.py`), targets and service mapping (`targets.py`), config and options flows. At the repo root because HACS expects it there. |
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

## Dependencies

Prefer a maintained library over our own code; write our own when nothing maintained fits. Pin exact versions (Dependabot proposes updates weekly). Everything bundled into the watch app runs in Zepp's QuickJS and counts against the package size, so check the bundled size too.

| Need | Choice | Why |
| --- | --- | --- |
| Watch ↔ phone messaging, side-service HTTP | `@zeppos/zml` | Zepp's official library. |
| Mean, median, quantiles, standard deviation | `simple-statistics` (ISC) | Maintained; about 3.4 KB bundled for what we use. `lib/stats.js` wraps it. |
| Circular statistics (compass headings) | Our own `lib/circular.js` | `angles` (MIT, maintained) has normalising, distances and a plain average, but no weighted mean and no spread measure, which the paint model needs; it also keeps a global scale setting. |
| Pitch and roll from gravity | Our own `watch/lib/aim.js` | Two textbook formulas. Sensor-fusion libraries (for example `ahrs`, unmaintained since 2023) need raw magnetometer readings, which Zepp OS doesn't expose (the compass API gives only a heading). |
| Snap / tap / flick detection | Our own `watch/lib/spike.js` | Nothing maintained exists for this; it will be tuned on our own recordings. |
| Bluetooth scanning | Zepp's `@zos/ble` directly | We only scan and read signal strength. `@silver-zepp/easy-ble` (MIT, last published 2024) helps with connecting to devices, which we don't do. |
| Storing paint data (M2) | To decide | Candidates: Zepp's built-in storage, or `@silver-zepp/easy-storage` (MIT, published 2025). |

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
node tools/emu/emu.mjs tap 240 362            # WristWand's row (below Settings on a fresh watch)
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
| `dev` | Work that's been adopted, ready for the next release. The changelogs' `## [Unreleased]` sections are kept up to date here. | Publishes the DEV test build on the [test-build page](https://raetha.github.io/zepp-wristwand/dev/). |
| `try/<topic>` | Experiments that may be dropped. Branched from `dev`. | CI checks only (tests and Zeus build). |

Day to day:

1. Small, settled changes go straight onto `dev`.
2. Anything exploratory starts on `try/<topic>`. If it's adopted, squash-merge it into `dev` (one commit with a clear message) and delete the branch. If not, delete the branch and note the idea in `docs/design.md`.
3. Each adopted change adds a line under `## [Unreleased]` in the affected component's `CHANGELOG.md`, written for someone installing it.
4. Test on the watch from the test-build page after each push to `dev`.

Releasing (only when the owner asks):

1. On `dev`, for each component being released: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (with a fresh empty `## [Unreleased]` above it) and set the version (`watch/app.json`: `version.name` = `X.Y.Z`, `version.code` + 1). For the first watch release, also delete `watch/DRAFT`.
2. Open a pull request from `dev` into `main`, titled with what it releases ("WristWand 0.2.0"). The description is the new changelog sections.
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

- **Every push and pull request:** `tools/release_plan.py` (fails if a non-draft component's version has no changelog section), `npm test`, a Zeus build of the watch app, and the HA component's tests (`ha-tests` job, Python 3.14).
- **On `main`, for each component whose `<component>-vX.Y.Z` tag doesn't exist yet:** creates the tag and a GitHub release, with notes from the changelog plus install instructions.
- **Every push to `main` or `dev`:** builds the DEV test build from the tip of `dev` and redeploys the Pages site. The public install page only ever offers released versions.

### Test builds

Every push to `dev` (or `main`) publishes a test build on an unlisted page: **https://raetha.github.io/zepp-wristwand/dev/** (not linked from the main site, `noindex`, blocked in `robots.txt`).

- `tools/make_dev_variant.py` copies `watch/` to `watch-dev/` (ignored by git) with its own app ID (release ID + 1,000,000 = 2132466), the name "WristWand DEV" and the version `<X.Y.Z>-dev.<run number>`.
- It installs **next to** the released app. Its settings in the Zepp app are separate, so enter the HA URL and token for it once.
- Its QR code (`zpkd1://raetha.github.io/zepp-wristwand/dev/watch/wristwand.zpk`) never changes: bookmark the page and rescan after each push. The Zepp app shows the build number. GitHub Pages can cache files for up to 10 minutes.

### Preview installs and the Settings page

**On the iPhone Zepp app, sideloaded apps get no Settings page.** Only apps installed from the Zepp store appear under Device → Device App Settings. We tried our own `.zpk` QR code, a `.zab` QR code (the Zepp app can't parse it), and uploads to Zepp's own preview service exactly as `zeus preview` does (one package, intermediate products included), under both the test and the registered app ID: the app installs and its side service runs, but no Settings entry appears and the Developer Mode → Mini Program list stays empty. So the watch doesn't depend on the Settings page: it pairs with the Home Assistant component (see `docs/design.md` → "Pairing").

CI still uploads each `dev` build to Zepp's preview service (`tools/zepp_preview.py`, which mirrors `zeus preview`) and shows that QR code first on the test-build page; it expires after **7 days** and each push makes a new one. That needs the owner's Zepp developer login as three repository secrets (**Settings → Secrets and variables → Actions**): `ZEPP_APPTOKEN`, `ZEPP_USERID`, `ZEPP_CNAME`. To get them, from any browser including a phone:

1. Open https://user.zepp.com/universalLogin/index.html#/login?project_name=zeppos_zeus_cli&platform_app=com.huami.webapp&project_redirect_uri=http%3A%2F%2Flocalhost%3A8765%2Flogin%2Fcallback and sign in with the Zepp developer account.
2. The browser then tries to open `http://localhost:8765/login/callback?apptoken=…&userid=…&cname=…` and fails to connect. That's expected: the address bar holds the values. Copy them into the three secrets (`apptoken` → `ZEPP_APPTOKEN`, `userid` → `ZEPP_USERID`, `cname` → `ZEPP_CNAME`; still URL-encoded is fine).

`cname` is a comma-separated list of the account's regional hosts; uploads go to the `api-mifit` one. When the token expires, the workflow fails with "token has expired": repeat both steps. Treat the token like a password.

The `watch-release` experiment (a preview under the registered app ID 1132466) can be removed from the workflow and `tools/dev_site.py` once the store route is set up.

The release QR code (`watch/docs/install-qr.png`) encodes `zpkd1://raetha.github.io/zepp-wristwand/watch/wristwand.zpk`. Regenerate with `npm run qr` if the repo moves.

## Licensing

Open source, but nobody else may sell the watch app. The dividing line is whether code could power someone else's paid watch app:

| Path | Licence | Why |
| --- | --- | --- |
| `watch/` (including `watch/lib/`) | CC BY-NC-SA 4.0 | The app, and the pointing, gesture, room-detection and protocol logic that would let someone build a paid copy. Zepp and other watch brands have paid stores. |
| `custom_components/wristwand/`, `ha/` (the HA component) | MIT | Home Assistant's ecosystem is free, with no paid store. |
| `lib/` | MIT | Generic helpers an unrelated project could use. |
| `tools/`, `.github/`, repo docs and config | MIT | Tooling. |

When adding code: generic with no tie to watches goes in `lib/`; anything watch- or Zepp-specific goes in `watch/`. The name "WristWand" and its icon aren't licensed for reuse. See the root `LICENSE`.

## Packaging for delivery

Sessions normally commit and push. When a session has only read access, deliver the repo as a zip instead:

```bash
zip -r zepp-wristwand.zip . -x ".git/*" "node_modules/*" "*/dist/*" "tools/.emu*/*" "*/__pycache__/*" "site/*" "out/*" "out-dev/*" "watch-dev/*"
```
