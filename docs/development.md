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
| `ha/` | (M2) the optional `wristwand` Home Assistant custom component, with its own changelog and version. |
| `tools/` | Packaging, release and site helpers, and `emu/` (the emulator). |
| `docs/` | This guide and `design.md`. |

## One-time setup

```bash
npm install                                  # @zeppos/zml, device types, ws
pip install -r tools/requirements.txt        # pillow, qrcode
npm install -g @zeppos/zeus-cli@1.9.3        # builds the watch app
```

## Everyday loop

1. Change code in `watch/`. Keep logic that doesn't need the Zepp runtime in `watch/lib/` (or `lib/` if it is generic, see "Licensing") with tests.
2. `npm test`.
3. `npm run build` (or `cd watch && zeus build`) to check it compiles.
4. Run it on the emulator (below): open the screens you changed, look at screenshots, and check `tools/.emu/serial.log` for `Mini Program Error`.
5. Push to `dev` and test on the watch from the test-build page.

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

- **Every push and pull request:** `tools/release_plan.py` (fails if a non-draft component's version has no changelog section), `npm test`, and a Zeus build of the watch app.
- **On `main`, for each component whose `<component>-vX.Y.Z` tag doesn't exist yet:** creates the tag and a GitHub release, with notes from the changelog plus install instructions.
- **Every push to `main` or `dev`:** builds the DEV test build from the tip of `dev` and redeploys the Pages site. The public install page only ever offers released versions.

### Test builds

Every push to `dev` (or `main`) publishes a test build on an unlisted page: **https://raetha.github.io/zepp-wristwand/dev/** (not linked from the main site, `noindex`, blocked in `robots.txt`).

- `tools/make_dev_variant.py` copies `watch/` to `watch-dev/` (ignored by git) with its own app ID (release ID + 1,000,000 = 2132466), the name "WristWand DEV" and the version `<X.Y.Z>-dev.<run number>`.
- It installs **next to** the released app. Its settings in the Zepp app are separate, so enter the HA URL and token for it once.
- Its QR code (`zpkd1://raetha.github.io/zepp-wristwand/dev/watch/wristwand.zpk`) never changes: bookmark the page and rescan after each push. The Zepp app shows the build number. GitHub Pages can cache files for up to 10 minutes.

The release QR code (`watch/docs/install-qr.png`) encodes `zpkd1://raetha.github.io/zepp-wristwand/watch/wristwand.zpk`. Regenerate with `npm run qr` if the repo moves.

## Licensing

Open source, but nobody else may sell the watch app. The dividing line is whether code could power someone else's paid watch app:

| Path | Licence | Why |
| --- | --- | --- |
| `watch/` (including `watch/lib/`) | CC BY-NC-SA 4.0 | The app, and the pointing, gesture, room-detection and protocol logic that would let someone build a paid copy. Zepp and other watch brands have paid stores. |
| `ha/` (the HA component, when added) | MIT | Home Assistant's ecosystem is free, with no paid store. |
| `lib/` | MIT | Generic helpers an unrelated project could use. |
| `tools/`, `.github/`, repo docs and config | MIT | Tooling. |

When adding code: generic with no tie to watches goes in `lib/`; anything watch- or Zepp-specific goes in `watch/`. The name "WristWand" and its icon aren't licensed for reuse. See the root `LICENSE`.

## Packaging for delivery

Sessions normally commit and push. When a session has only read access, deliver the repo as a zip instead:

```bash
zip -r zepp-wristwand.zip . -x ".git/*" "node_modules/*" "*/dist/*" "tools/.emu*/*" "*/__pycache__/*" "site/*" "out/*" "out-dev/*" "watch-dev/*"
```
