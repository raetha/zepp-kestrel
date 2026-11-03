#!/usr/bin/env python3
"""Make Kestrel's side-by-side test build: watch-dev/ (ignored by git), "Kestrel DEV".

Kestrel's settings for zepp-devkit's dev-variant: its own app ID, registered in Zepp's
developer console as "Kestrel Dev" (the preview upload needs it), the build stamped into
lib/version.js (both halves report it), and docs and tests left out. The copy sits next to
watch/, so ../node_modules resolution keeps working.

  python3 tools/make_dev_variant.py <build-number> [<short-sha>]
"""
import sys
from pathlib import Path

from zepp_devkit.devvariant import make_variant

REPO = Path(__file__).resolve().parents[1]
DEV_APPID = 1134161  # "Kestrel Dev" in the Zepp Console (Oct 31, 2026); the release is 1132466

build = int(sys.argv[1])
sha = sys.argv[2] if len(sys.argv) > 2 else ""
meta = make_variant(REPO / "watch", REPO / "watch-dev", DEV_APPID, build, sha, ignore=["docs", "test"], stamp=["lib/version.js"])
print(f"watch-dev: {meta['appName']} {meta['version']['name']} (appId {meta['appId']})")
