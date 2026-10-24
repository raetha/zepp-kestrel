#!/usr/bin/env python3
"""Make watch-compat/: the watch app wired to walk itself through its screens on launch.

Used by tools/compat/sweep.mjs on each watch model's emulator image. On launch it logs
what the firmware offers ("KCOMPAT caps {...}"), then opens Point, Paint and More in turn
(each logs "KCOMPAT shown <page>" and goes back after a few seconds), with a painted
device and a few targets so those screens have something to show. Never commit it.

  python3 tools/compat/make_variant.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DST = REPO / "watch-compat"

subprocess.run([sys.executable, str(REPO / "tools/make_dev_variant.py"), "1", "compat"], check=True, stdout=subprocess.DEVNULL)
if DST.exists():
    shutil.rmtree(DST)
(REPO / "watch-dev").rename(DST)
shutil.copy(REPO / "tools/compat/compat.js", DST / "page/compat.js")


def patch(rel: str, old: str, new: str) -> None:
    p = DST / rel
    s = p.read_text()
    if old not in s:
        sys.exit(f"{rel}: can't find {old!r}")
    p.write_text(s.replace(old, new, 1))


patch(
    "page/store.js",
    "export function paintedDevices() {",
    "export function paintedDevices() {\n"
    "  return [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light', domain: 'light', dimmable: true,"
    " spots: [{ heading: 0, headingSpread: 170, pitch: 0, pitchSpread: 80, n: 60 }] }]\n",
)
patch(
    "page/store.js",
    "export const targets = () => read('kestrel.targets', [])",
    "export const targets = () => [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light' },"
    " { id: 'switch.kettle', name: 'Kettle' }, { id: 'scene.movie', name: 'Movie time' }]",
)
# every screen but Home says it's up, and goes back by itself
patch(
    "page/trail.js",
    "      if (k === 'onInit') note('open', name)",
    "      if (k === 'build' && name !== 'home') {\n"
    "        console.log(`KCOMPAT shown ${name}`)\n"
    "        setTimeout(() => { try { require_back() } catch (e) { console.log(`KCOMPAT back failed ${e}`) } }, 6000)\n"
    "      }\n"
    "      if (k === 'onInit') note('open', name)",
)
patch("page/trail.js", "export function tracked(", "import { back as require_back } from '@zos/router'\n\nexport function tracked(")
# Home runs the checks, then opens each screen in turn
patch(
    "page/home.js",
    "      build() {\n",
    "      build() {\n"
    "        const g = getApp()._options.globalData\n"
    "        g.compat = g.compat || 0\n"
    "        const order = ['page/point', 'page/paint', 'page/more']\n"
    "        const next = () => { const url = order[g.compat++]; if (url) setTimeout(() => push({ url }), 2500); else console.log('KCOMPAT done') }\n"
    "        console.log(`KCOMPAT shown home ${g.compat}`)\n"
    "        if (g.compat === 0) checks(next)\n"
    "        else next()\n",
)
patch("page/home.js", "import { push } from '@zos/router'", "import { push } from '@zos/router'\nimport { checks } from './compat.js'")
print(DST.relative_to(REPO))
