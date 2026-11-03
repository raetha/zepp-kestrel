#!/usr/bin/env python3
"""Release notes: a changelog section plus how to install both parts (zepp-devkit's
notes(), with Kestrel's install texts).

  python3 tools/release_notes.py <version> > notes.md
  python3 tools/release_notes.py Unreleased --test-build <n> > notes.md

Used by CI for every GitHub release (`build.yml` → release), which HACS shows as the
integration's release notes, and, with --test-build, for the integration's dev
pre-releases (their notes are the changelog's Unreleased section).
"""
import argparse
import sys
from pathlib import Path

from zepp_devkit.project import component
from zepp_devkit.release import notes

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import GITHUB, PAGES, REPO  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("version")
ap.add_argument("--test-build", type=int, help="a dev pre-release: its run number")
args = ap.parse_args()

install = f"""Kestrel has two parts, released together under one version: update both.

**1. The Home Assistant integration:** install with HACS (⋮ → Custom repositories → `{GITHUB}`, type Integration), or extract `kestrel.zip` from this release into `custom_components/kestrel/` in your Home Assistant config folder, then restart and add the Kestrel integration (Settings → Devices & services).

**2. The watch app:** from the Zepp app's store (search for Kestrel), or from the [install page](https://{PAGES}/): pick your watch and scan its QR code in the Zepp app (Profile → your watch → Developer Mode → scan; turn on Developer Mode under Profile → Settings → About by tapping the logo 7 times). The packages for every watch are attached below.

**Pair:** with your phone on the home Wi-Fi, open Kestrel on the watch → Pair with HA, pick your Home Assistant and type the 6-digit code it shows.

More: [README]({GITHUB}#readme)"""
intro = f"**Test build {args.test_build}** of Kestrel from `dev`, for trying what's coming. The Home Assistant integration: in HACS, enable and turn on Kestrel's **Pre-release** switch (disabled by default); HACS then offers this build as an update, and Home Assistant shows its version. The watch app: install it from the [test-build page](https://{PAGES}/dev/)."

print(notes(component("kestrel", REPO).changelog, args.version, install, args.test_build, intro))
