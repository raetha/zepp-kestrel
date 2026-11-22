# Submitting Kestrel to the Zepp store

What's in place, what's left, and where the store-facing text is. Zepp's own guide: [How to submit a Mini Program](https://docs.huami.com/docs/distribute/) (review takes about 1–5 working days). The store text, permissions, privacy and work statements are in [`watch/docs/store/listing.md`](../watch/docs/store/listing.md).

## Already in place

- **App ID:** 1132466, registered in the [Zepp Console](https://console.zepp.com/) as Kestrel and set in `watch/app.json`. Test builds use their own registered ID, 1134161 (Kestrel DEV), so they never collide with the store app. The store checks that the package's `appId` matches the listing.
- **Package:** each watch release on GitHub attaches `kestrel-<version>.zab`, built for every Zepp OS screen. That's the file the store takes.
- **Images** (`watch/docs/store/`): `icon.png` (240×240, transparent) and four screenshots, 360×360 PNGs with the round screen centred and transparent outside it, as the Console asks. To redo them after the screens change:
  1. `python3 tools/store/make_demo.py` (a build with a pretend phone and a few demo devices, `watch-store/`, never committed);
  2. on the emulator: `node tools/emu/emu.mjs install watch-store`, open it (`apps`, then the newest Kestrel), and save 480×480 shots as `watch/docs/store/raw/1-home.png`, `2-point.png` (Point → tap to trigger), `3-paint.png` (Paint a device → Living room) and `4-more.png`;
  3. `python3 tools/store/assets.py` writes the store images and the README's picture.
- **Privacy statement:** `PRIVACY.md`. Kestrel sends nothing to the developer or any third party; it talks only to the user's own Home Assistant.
- **Languages:** the store text is in English, Simplified and Traditional Chinese. The watch app itself is English only (`app.json` has `en-US`), which the descriptions say.

## Left to do at the first release

1. **Release** the watch app and the Home Assistant integration together (`docs/development.md` → "Branches and releases": remove both `DRAFT` files, set the versions, date the changelogs). The store listing points people to the integration, so it must be on GitHub (HACS) first.
2. **Supported devices:** the Console detects them from the `.zab`. Untick the watches on Zepp OS 3.x (Falcon, Cheetah round and square, Cheetah Pro, T-Rex Ultra, Active) and the Active Edge: the README's table lists them as not supported. Kestrel also needs a compass: leave a model out if its specifications say it has none.
3. **Country or region, category** (see the listing), then the text, images, permissions, privacy statement and work statement from `listing.md`.
4. **Submit for approval.** If the review asks for a test account or a demo: Kestrel needs the user's own Home Assistant, so describe the flow (pair, paint, point) and link the README.
5. **After approval:** check that a store update replaces the phone part of the app (Home Assistant's Phone app version sensor, after the next update), and add the store link to the README, the install page and the release notes (`tools/release_notes.py`).

## Later versions

Use **Version Upgrade** in the Console with the new release's `.zab` and its changelog section (the GitHub release notes) as the update notes.
