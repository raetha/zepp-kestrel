#!/usr/bin/env python3
"""The Zepp store's images for the watch app (zepp-devkit store-images), from emulator
screenshots and the logo.

  python3 tools/store/assets.py

Reads watch/docs/store/raw/*.png (480x480 emulator screenshots of the demo build,
tools/store/make_demo.py) and writes watch/docs/store/screenshot-*.png (360x360, transparent
outside the round screen) and icon.png (240x240, from brand/kestrel-1024.png), and the
README's and install page's picture, watch/docs/screenshot-home.png.
"""
from pathlib import Path

from PIL import Image
from zepp_devkit.store import icon, screenshots

REPO = Path(__file__).resolve().parents[2]
STORE = REPO / "watch" / "docs" / "store"

for f in screenshots(STORE / "raw", STORE):
    print(f.relative_to(REPO))
print(icon(REPO / "brand" / "kestrel-1024.png", STORE / "icon.png").relative_to(REPO))
home = STORE / "raw" / "1-home.png"
if home.exists():
    Image.open(home).convert("RGB").save(REPO / "watch" / "docs" / "screenshot-home.png", optimize=True)
