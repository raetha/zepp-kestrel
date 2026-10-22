"""The releasable parts of this repo, each versioned and released on its own.

  watch  Zepp OS mini program (watch app + side service + settings page)
         version: watch/app.json -> app.version.name; tag watch-v<version>
  ha     (M2) Home Assistant custom component, custom_components/wristwand/manifest.json

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
    ha = REPO / "ha"
    manifests = sorted(ha.glob("custom_components/*/manifest.json")) if ha.exists() else []
    if manifests:
        man = json.loads(manifests[0].read_text())
        out.append(("ha", man["version"], f"{man['name']} HA component", (ha / "DRAFT").exists()))
    return out
