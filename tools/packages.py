#!/usr/bin/env python3
"""Split the .zab that `zeus build` writes into one .zpk per screen and chip, for QR installs.

A QR install sends exactly one .zpk, and the Zepp app can't install a .zab (it can't
parse it), so each watch needs the package built for its screen. This writes them all,
named by screen and chip, plus packages.json saying which device IDs each one is for:

  python3 tools/packages.py watch/dist out/watch [--prefix kestrel]

  out/watch/kestrel-r480-zps.zpk ...
  out/watch/packages.json  {"kestrel-r480-zps.zpk": {"screen": "round 480x480", "chip": "ZPS", "sources": [...]}}

The store takes the .zab itself and gives each watch its own package.
"""
import argparse
import io
import json
import sys
import zipfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("dist", type=Path)
ap.add_argument("dest", type=Path)
ap.add_argument("--prefix", default="kestrel")
args = ap.parse_args()

zabs = sorted(args.dist.glob("*.zab"))
if len(zabs) != 1:
    sys.exit(f"expected exactly one .zab in {args.dist}, found {len(zabs)}")
args.dest.mkdir(parents=True, exist_ok=True)
index = {}
with zipfile.ZipFile(zabs[0]) as zab:
    manifest = json.loads(zab.read("manifest.json"))
    for entry in manifest["zpks"]:
        platform = entry["platforms"][0]
        zpk = zab.read(entry["name"])
        with zipfile.ZipFile(io.BytesIO(zpk)) as z, zipfile.ZipFile(io.BytesIO(z.read("device.zip"))) as d:
            sources = sorted({p.get("deviceSource") for p in json.loads(d.read("app.json"))["platforms"]} - {None})
        shape = "r" if platform["screenType"] == "round" else "s"
        size = platform["screenResolution"]
        res = size.split("x")[0] if shape == "r" else size
        name = f"{args.prefix}-{shape}{res}-{platform['cpuPlatform'].lower()}.zpk"
        (args.dest / name).write_bytes(zpk)
        index[name] = {"screen": f"{platform['screenType']} {size}", "chip": platform["cpuPlatform"], "sources": sources}
(args.dest / "packages.json").write_text(json.dumps(index, indent=2) + "\n")
print(f"{len(index)} packages in {args.dest}")
