"""Project constants for the site and install texts. The releasable components themselves
(watch app, Home Assistant component) are listed in zepp-devkit.json, for zepp-devkit's
release-plan, changelog and notes.

  watch  Zepp OS mini program (watch app + side service + settings page)
         version: watch/app.json -> app.version.name; tag watch-v<version>
  ha     Home Assistant component: custom_components/kestrel/ (at the repo root, where
         HACS expects it); version in its manifest.json; changelog, tests and DRAFT in ha/

A component containing a DRAFT file is built and tested but never released.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PAGES = "raetha.github.io/zepp-kestrel"
GITHUB = "https://github.com/raetha/zepp-kestrel"

# Package file name for the watch app on the install site (fixed, so QR codes never change)
WATCH_ZPK = "kestrel.zpk"


def watch_meta(app_dir=REPO / "watch"):
    return json.loads((app_dir / "app.json").read_text())["app"]
