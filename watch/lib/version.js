// The build's version, baked into both halves of the app: the watch's pages and
// the phone's side service (Zepp bundles lib/ into each). Comparing them tells
// when the Zepp app runs a different build's side service than the watch runs,
// which happened on an iPhone after a test-build install.
//
// Matches app.json's version.name (watch/test checks); tools/make_dev_variant.py
// rewrites it for test builds.
export const BUILD = '0.1.0'
