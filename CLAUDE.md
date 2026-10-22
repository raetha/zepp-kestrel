# Notes for Claude sessions

WristWand: point an Amazfit / Zepp OS watch at a smart-home device and trigger it, with Home Assistant. Developed on the Amazfit Balance 3 (480×480 round, API level 4.4). The canonical guide is `docs/development.md`, and the design is `docs/design.md`. Read both before changing anything. This file is the short version of what a new session needs.

## How we work

- Sessions can push to this repo. If a session has read-only access, fall back to a zip of the repo (`docs/development.md` → "Packaging for delivery").
- **Branches** (`docs/development.md` → "Branches and releases"): never push to `main`; it gets one squash-merged pull request per release. Adopted work goes on `dev`, and experiments that may be dropped go on `try/<topic>` branches off `dev`. Each push to `dev` publishes a DEV test build at https://raetha.github.io/zepp-wristwand/dev/, and the owner tests it on the watch by scanning its QR code. The owner has no local Zepp dev environment, so that page is how builds reach the watch.
- Record each adopted change under `## [Unreleased]` in the component's `CHANGELOG.md` (`watch/CHANGELOG.md`, later `ha/CHANGELOG.md`), written for people installing it. Never bump a version or date a changelog without being asked: that's the release pull request (`dev` → `main`), which the owner squash-merges. CI then resets `dev` to `main` (when nothing new landed on `dev` meanwhile).
- `watch/DRAFT` keeps the watch app from being released until the owner says the first release is ready.
- Name: **WristWand** (store name; "Wristwand" in prose is fine). It is inspired by commercial point-and-snap apps for other watches but must never use their names, code, assets or branding.
- Licence: MIT for everything.

## Validate on the real firmware

- `npm test` runs the pure-JS library tests (`watch/lib/`). Fast, but no Zepp runtime.
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

- A `.zab` holds one `.zpk` per screen and chip. `tools/extract_zpk.py` picks by device ID (Balance 3 = 11141376); a QR install must get that one.
- The emulator has no phone: the side service and settings page never run there, so watch → phone requests fail ("Phone not reachable"), which is the expected result.
- The emulator feeds synthetic motion at about 25 Hz in every frequency mode and a wandering compass. Its sensor numbers say nothing about the real watch.
- On every launch the emulator log shows `Mini Program Error TypeError: cannot set property 'exports' of undefined` from `app.js`. It comes after ZML's `BaseApp` has registered the app and doesn't stop anything working; watch for it on the real watch.
- `watch/lib/` must stay free of `@zos/*` imports so Node can test it; its own `package.json` sets `"type": "module"`.
- Dependencies live in the root `package.json`; Zeus resolves them from `watch/` and `watch-dev/` by walking up.
