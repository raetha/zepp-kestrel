"""The releasable parts of this repo, each versioned and released on its own.

  watch  Zepp OS mini program (watch app + side service + settings page)
         version: watch/app.json -> app.version.name; tag watch-v<version>
  ha     Home Assistant component: custom_components/wristwand/ (at the repo root, where
         HACS expects it); version in its manifest.json; changelog, tests and DRAFT in ha/

A component containing a DRAFT file is built and tested but never released.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PAGES = "raetha.github.io/zepp-wristwand"
GITHUB = "https://github.com/raetha/zepp-wristwand"

# Package file name for the watch app on the install site (fixed, so QR codes never change)
WATCH_ZPK = "wristwand.zpk"


def watch_meta(app_dir=REPO / "watch"):
    return json.loads((app_dir / "app.json").read_text())["app"]


def components():
    """[(name, version, title, is_draft)] for every component present."""
    out = []
    watch = REPO / "watch"
    if (watch / "app.json").exists():
        meta = watch_meta(watch)
        out.append(("watch", meta["version"]["name"], f"{meta['appName']} watch app", (watch / "DRAFT").exists()))
    manifest = REPO / "custom_components" / "wristwand" / "manifest.json"
    if manifest.exists():
        man = json.loads(manifest.read_text())
        out.append(("ha", man["version"], f"{man['name']} Home Assistant component", (REPO / "ha" / "DRAFT").exists()))
    return out
