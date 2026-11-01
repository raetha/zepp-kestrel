#!/usr/bin/env python3
"""The Zepp store's images for the watch app, from emulator screenshots and the logo.

  python3 tools/store/assets.py

Reads watch/docs/store/raw/*.png (480×480 emulator screenshots of the demo build,
tools/store/make_demo.py) and writes watch/docs/store/screenshot-*.png: 360×360 PNGs,
the round screen centred with no margin and transparent outside it, as the Zepp Console
asks. Writes watch/docs/store/icon.png (240×240, transparent) from brand/kestrel-1024.png,
and watch/docs/screenshot-home.png (the README's and install page's picture).
"""
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
STORE = REPO / "watch" / "docs" / "store"
SIZE = 360

mask = Image.new("L", (SIZE * 4, SIZE * 4), 0)
ImageDraw.Draw(mask).ellipse((0, 0, SIZE * 4 - 1, SIZE * 4 - 1), fill=255)
mask = mask.resize((SIZE, SIZE), Image.LANCZOS)  # antialiased edge

raws = sorted((STORE / "raw").glob("*.png"))
for raw in raws:
    shot = Image.open(raw).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    shot.putalpha(mask)
    name = raw.stem.split("-", 1)[-1]
    shot.save(STORE / f"screenshot-{name}.png", optimize=True)
    print(f"watch/docs/store/screenshot-{name}.png")

Image.open(REPO / "brand" / "kestrel-1024.png").convert("RGBA").resize((240, 240), Image.LANCZOS).save(STORE / "icon.png", optimize=True)
print("watch/docs/store/icon.png")
home = STORE / "raw" / "1-home.png"
if home.exists():
    Image.open(home).convert("RGB").save(REPO / "watch" / "docs" / "screenshot-home.png", optimize=True)
