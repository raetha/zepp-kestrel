"""Project constants for the site and install texts.

Kestrel is released as one component (zepp-devkit.json, for zepp-devkit's release-plan,
changelog and notes): the watch app (Zepp OS mini program with side service and settings
page, watch/) and the Home Assistant integration (custom_components/kestrel/, at the repo
root where HACS expects it; its tests in ha/) share one version, one CHANGELOG.md and one
tag, <version> (no leading "v": HACS shows tag names). While DRAFT exists, CI builds and tests but never releases.
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
