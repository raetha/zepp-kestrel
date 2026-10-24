#!/usr/bin/env python3
"""Release notes for one component: its changelog section plus install instructions.

  python3 tools/release_notes.py <component> <version> > notes.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from changelog import section  # noqa: E402
from components import GITHUB, PAGES  # noqa: E402

component, version = sys.argv[1], sys.argv[2]
body = section(component, version)
if body is None:
    sys.exit(f"no changelog section for {component} {version}")
raw = "https://raw.githubusercontent.com/raetha/zepp-kestrel/main"
if component == "watch":
    install = f"""**Install:** in the Zepp app, turn on Developer Mode (Profile → Settings → About, tap the logo 7 times), then Profile → your watch → Developer Mode → scan:

<img src="{raw}/watch/docs/install-qr.png" width="180" alt="Install QR code">

Or download `kestrel-{version}.zpk` below. Then open Kestrel's settings in the Zepp app and enter your Home Assistant URL and token. More: [install page](https://{PAGES}/) · [README]({GITHUB}#readme)"""
else:
    install = f"Install with HACS (Custom repositories → `{GITHUB}`, type Integration), or copy `custom_components/kestrel` into your Home Assistant config folder. Then add the Kestrel integration and pair from the watch. More: [README]({GITHUB}#readme)"
print(f"{body}\n\n---\n\n{install}")
