#!/usr/bin/env python3
"""Pull one device's package (.zpk) out of the .zab that `zeus build` writes to dist/.

A .zab holds one .zpk per screen size and chip family. A QR install sends exactly one
.zpk to the watch, so we must pick the package built for the target watch. Picking the
wrong one still installs, but the app is scaled for another screen. Early test builds
shipped the 454x454 build to 480x480 watches that way.

  python3 tools/extract_zpk.py dist out.zpk [--device-source N] [--device-zip out-device.zip]

--device-source defaults to 11141376 (Amazfit Balance 3, 480x480). Device IDs are listed
at https://docs.zepp.com/docs/reference/related-resources/device-list/
"""
import argparse
import io
import json
import sys
import zipfile
from pathlib import Path

BALANCE_3 = 11141376

ap = argparse.ArgumentParser()
ap.add_argument("dist", type=Path)
ap.add_argument("dest", type=Path)
ap.add_argument("--device-source", type=int, default=BALANCE_3)
ap.add_argument("--device-zip", type=Path, help="also write the inner device.zip (for the emulator)")
args = ap.parse_args()

zabs = sorted(args.dist.glob("*.zab"))
if len(zabs) != 1:
    sys.exit(f"expected exactly one .zab in {args.dist}, found {len(zabs)}")
with zipfile.ZipFile(zabs[0]) as zab:
    names = [n for n in zab.namelist() if n.endswith(".zpk")]
    match = None
    for name in names:
        zpk = zab.read(name)
        with zipfile.ZipFile(io.BytesIO(zpk)) as z:
            device = z.read("device.zip")
        with zipfile.ZipFile(io.BytesIO(device)) as d:
            app = json.loads(d.read("app.json"))
        sources = [p.get("deviceSource") for p in app.get("platforms", [])]
        if args.device_source in sources:
            match = (name, zpk, device)
            break
    if not match:
        sys.exit(f"no package in {zabs[0].name} targets deviceSource {args.device_source}")
name, zpk, device = match
args.dest.parent.mkdir(parents=True, exist_ok=True)
args.dest.write_bytes(zpk)
if args.device_zip:
    args.device_zip.parent.mkdir(parents=True, exist_ok=True)
    args.device_zip.write_bytes(device)
print(f"wrote {args.dest} ({len(zpk)} bytes): {name} for deviceSource {args.device_source}")
