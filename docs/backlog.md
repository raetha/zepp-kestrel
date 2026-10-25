# Backlog

Ideas and work deliberately left for later, with what's known so far. Pick from here when planning a release.

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
