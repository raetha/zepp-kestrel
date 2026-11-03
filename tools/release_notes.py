#!/usr/bin/env python3
"""Release notes for one component: its changelog section plus how to install it
(zepp-devkit's notes(), with Kestrel's install texts).

  python3 tools/release_notes.py <component> <version> > notes.md
  python3 tools/release_notes.py <component> Unreleased --test-build <n> > notes.md

Used by CI for every GitHub release (`build.yml` → release), which HACS shows as the
integration's release notes, and, with --test-build, for the Home Assistant component's
dev pre-releases (their notes are the changelog's Unreleased section).
"""
import argparse
import sys
from pathlib import Path

from zepp_devkit.project import component
from zepp_devkit.release import notes

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import GITHUB, PAGES, REPO  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("component", choices=["watch", "ha"])
ap.add_argument("version")
ap.add_argument("--test-build", type=int, help="a dev pre-release: its run number")
args = ap.parse_args()

PAIR = "With your phone on the home Wi-Fi, open Kestrel on the watch → Pair with HA, pick your Home Assistant and type the 6-digit code it shows."
if args.component == "watch":
    install = f"""**Install the watch app** from the Zepp app's store (search for Kestrel), or from the [install page](https://{PAGES}/): pick your watch and scan its QR code in the Zepp app (Profile → your watch → Developer Mode → scan; turn on Developer Mode under Profile → Settings → About by tapping the logo 7 times). The packages for every watch are attached below.

**It needs the Kestrel Home Assistant integration** (install it with HACS from `{GITHUB}`). {PAIR}

More: [README]({GITHUB}#readme)"""
    intro = f"**Test build {args.test_build}** of the Kestrel watch app from `dev`, for trying what's coming. Install it from the [test-build page](https://{PAGES}/dev/)."
else:
    install = f"""**Install** with HACS (⋮ → Custom repositories → `{GITHUB}`, type Integration), or extract `kestrel.zip` from the release into `custom_components/kestrel/` in your Home Assistant config folder, then restart and add the Kestrel integration (Settings → Devices & services). Then install the Kestrel watch app and pair: {PAIR[0].lower()}{PAIR[1:]}

More: [README]({GITHUB}#readme)"""
    intro = f"**Test build {args.test_build}** of the Kestrel Home Assistant component from `dev`, for trying what's coming. In HACS, enable and turn on Kestrel's **Pre-release** switch (disabled by default); HACS then offers it as an update. Home Assistant shows this build's version."

print(notes(component(args.component, REPO).changelog, args.version, install, args.test_build, intro))
