#!/usr/bin/env python3
"""Make a side-by-side test build of the watch app: watch-dev/ with its own app ID.

The copy sits next to watch/ (so ../node_modules resolution keeps working), installs
alongside the released app as "Kestrel DEV", and carries a dev version. Its side
service and settings are separate too, so enter the HA URL and token for it once.

  python3 tools/make_dev_variant.py <build-number> [<short-sha>]

Adapted from raetha/zepp-watch-faces.
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
# Kestrel DEV's own app ID, registered in Zepp's developer console (Oct 31, 2026). Until then
# test builds used a made-up ID (the release ID + 1,000,000), and the Zepp app never listed
# them under Developer Mode, nor updated their phone side on a new install.
DEV_APPID = 1134161

build = int(sys.argv[1])
sha = sys.argv[2] if len(sys.argv) > 2 else ""
src, dst = REPO / "watch", REPO / "watch-dev"
if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("dist", "docs", "test", "__pycache__", "DRAFT"))
app = json.loads((dst / "app.json").read_text())
meta = app["app"]
base_version = meta["version"]["name"]
meta["appId"] = DEV_APPID
meta["appName"] = f"{meta['appName']} DEV"
meta["version"] = {"code": build, "name": f"{base_version}-dev.{build}"}
meta["description"] = f"Test build {build} {sha}".strip()
for lang in app.get("i18n", {}).values():
    lang["appName"] = meta["appName"]
(dst / "app.json").write_text(json.dumps(app, indent=2) + "\n")
# both halves of the app report the build (lib/version.js)
version_js = dst / "lib" / "version.js"
text = version_js.read_text()
old = f"export const BUILD = '{base_version}'"
if old not in text:
    sys.exit(f"{version_js}: expected {old!r} (keep it in step with app.json)")
version_js.write_text(text.replace(old, f"export const BUILD = '{meta['version']['name']}'"))
print(f"{dst.relative_to(REPO)}: {meta['appName']} {meta['version']['name']} (appId {meta['appId']})")
