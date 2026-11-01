#!/usr/bin/env python3
"""Release notes for one component: its changelog section plus how to install it.

  python3 tools/release_notes.py <component> <version> > notes.md
  python3 tools/release_notes.py <component> Unreleased --test-build <n> > notes.md

Used by CI for every GitHub release (`build.yml` → release), which HACS shows as the
integration's release notes, and, with --test-build, for the Home Assistant component's
dev pre-releases (their notes are the changelog's Unreleased section).
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from changelog import section  # noqa: E402
from components import GITHUB, PAGES  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("component", choices=["watch", "ha"])
ap.add_argument("version")
ap.add_argument("--test-build", help="a dev pre-release: its run number")
args = ap.parse_args()

body = section(args.component, args.version)
if body is None:
    sys.exit(f"no changelog section for {args.component} {args.version}")

PAIR = "With your phone on the home Wi-Fi, open Kestrel on the watch → Pair with HA, pick your Home Assistant and type the 6-digit code it shows."
if args.component == "watch":
    install = f"""**Install the watch app** from the Zepp app's store (search for Kestrel), or from the [install page](https://{PAGES}/): pick your watch and scan its QR code in the Zepp app (Profile → your watch → Developer Mode → scan; turn on Developer Mode under Profile → Settings → About by tapping the logo 7 times). The packages for every watch are attached below.

**It needs the Kestrel Home Assistant integration** (install it with HACS from `{GITHUB}`). {PAIR}

More: [README]({GITHUB}#readme)"""
else:
    install = f"""**Install** with HACS (⋮ → Custom repositories → `{GITHUB}`, type Integration), or copy `custom_components/kestrel` into your Home Assistant config folder, then restart and add the Kestrel integration (Settings → Devices & services). Then install the Kestrel watch app and pair: {PAIR[0].lower()}{PAIR[1:]}

More: [README]({GITHUB}#readme)"""

if args.test_build:
    body = body or "Nothing new since the last release yet."
    how = ("Install it through HACS with beta versions turned on for Kestrel." if args.component == "ha"
           else f"Install it from the [test-build page](https://{PAGES}/dev/).")
    name = "Home Assistant component" if args.component == "ha" else "watch app"
    print(f"**Test build {args.test_build}** of the Kestrel {name} from `dev`, for trying what's coming. {how}\n\n"
          f"## Changes since the last release\n\n{body}")
else:
    print(f"{body}\n\n---\n\n{install}")
