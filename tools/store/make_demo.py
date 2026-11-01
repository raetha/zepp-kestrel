#!/usr/bin/env python3
"""Make watch-store/: the watch app with a pretend phone, for store screenshots on the emulator.

The emulator has no phone, so this variant answers the watch's requests itself: paired
with "Home", and a sync with a few devices in a few rooms, painted wide so Point locks
on whatever the emulator's wandering compass says. Never commit watch-store/.

  python3 tools/store/make_demo.py
  node tools/emu/emu.mjs install watch-store     # then open it and take shots (docs/store.md)
"""
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DST = REPO / "watch-store"

subprocess.run([sys.executable, str(REPO / "tools/make_dev_variant.py"), "1", "store"], check=True, stdout=subprocess.DEVNULL)
if DST.exists():
    shutil.rmtree(DST)
(REPO / "watch-dev").rename(DST)

# the store's screenshots show the released name and version
app = (DST / "app.json").read_text()
app = app.replace('"Kestrel DEV"', '"Kestrel"').replace('-dev.1"', '"')
(DST / "app.json").write_text(app)
v = DST / "lib/version.js"
v.write_text(v.read_text().replace("-dev.1'", "'"))

SPREAD = "headingSpread: 170, pitch: 0, pitchSpread: 80, n: 60"
FAKE = f"""
const DEMO_SYNC = {{
  watch_id: 'demo', targets_hash: 'demo', paints_rev: 1, rooms_rev: 0, settings_rev: 0, room: {{ id: 'living_room', name: 'Living room' }},
  areas: [{{ id: 'living_room', name: 'Living room' }}, {{ id: 'kitchen', name: 'Kitchen' }}, {{ id: 'bedroom', name: 'Bedroom' }}],
  targets: [
    {{ id: 'light.floor_lamp', name: 'Floor lamp', area_id: 'living_room', dimmable: true }},
    {{ id: 'media_player.tv', name: 'TV', area_id: 'living_room', volume: true }},
    {{ id: 'light.reading_light', name: 'Reading light', area_id: 'living_room', dimmable: true }},
    {{ id: 'switch.fan', name: 'Ceiling fan', area_id: 'living_room' }},
    {{ id: 'scene.movie_night', name: 'Movie night', area_id: 'living_room' }},
    {{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling', area_id: 'kitchen', dimmable: true }},
    {{ id: 'lock.back_door', name: 'Back door', area_id: 'kitchen', confirm: true }},
    {{ id: 'light.bedside', name: 'Bedside lamp', area_id: 'bedroom', dimmable: true }},
  ],
  paints: {{ 'light.floor_lamp': [{{ heading: 0, {SPREAD} }}] }},
}}
function demoReply(method) {{
  if (method === METHOD.STATUS) return {{ paired: true, haName: 'Home', url: 'http://homeassistant.local', build: BUILD }}
  if (method === METHOD.SYNC) return DEMO_SYNC
  if (method === METHOD.FIRE) return {{ ok: true, state: 'on' }}
  return {{ ok: true }}
}}
"""
ui = DST / "page/ui.js"
s = ui.read_text()
old = "export function ask(page, method, params, timeout = 6000) {\n"
if old not in s:
    sys.exit("page/ui.js: ask() not found")
s = s.replace(old, FAKE + old + "  return Promise.resolve(demoReply(method))\n", 1)
ui.write_text(s)

# the emulator's synthetic motion never holds still: aim steadily at the floor lamp
pt = DST / "page/point.js"
s = pt.read_text()
old = "      onAim(a) {\n"
if old not in s:
    sys.exit("page/point.js: onAim() not found")
pt.write_text(s.replace(old, old + "        a = { ...a, ready: true, heading: 2, pitch: 4, roll: 0 }\n", 1))
print("watch-store ready: node tools/emu/emu.mjs install watch-store")
