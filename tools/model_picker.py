#!/usr/bin/env python3
"""The "pick your watch" part of the install pages: one QR code per package.

A QR install sends one .zpk, built for one screen and chip (tools/packages.py), so the
page lists the watch models (watch/models.json) and shows the QR code of the package for
the one picked. Models with no package (not supported) aren't listed.

  from model_picker import picker
  html = picker(site / "dev" / "watch", "raetha.github.io/zepp-kestrel/dev/watch", default="Balance 3")
"""
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import REPO  # noqa: E402
from make_qr import make  # noqa: E402

STATUS = {
    "tested": "tested",
    "emulator": "checked in the emulator",
    "untested": "untested",
}


def models():
    return json.loads((REPO / "watch" / "models.json").read_text())["models"]


def picker(watch_dir: Path, url_base: str, default: str = "Balance 3") -> str:
    """QR codes for every package in watch_dir/packages.json, and a model list choosing between them."""
    packages = json.loads((watch_dir / "packages.json").read_text())
    by_source = {s: name for name, p in packages.items() for s in p["sources"]}
    options = []
    for m in models():
        if m["status"] not in STATUS:
            continue
        pkg = next((by_source[s] for s in m["sources"] if s in by_source), None)
        if not pkg:
            continue
        qr = f"qr-{pkg.removesuffix('.zpk')}.png"
        if not (watch_dir / qr).exists():
            make(watch_dir / qr, f"zpkd1://{url_base}/{pkg}")
        label = f"{m['name']} ({STATUS[m['status']]})"
        selected = " selected" if m["name"] == default else ""
        options.append(
            f'<option value="{html.escape(pkg)}" data-qr="{html.escape(qr)}"{selected}>{html.escape(label)}</option>'
        )
    first = next((o for o in options if " selected" in o), options[0] if options else "")
    if not first:
        return "<p>No packages.</p>"
    pkg0 = first.split('value="')[1].split('"')[0]
    qr0 = first.split('data-qr="')[1].split('"')[0]
    return f'''<label for="model">Your watch</label>
<select id="model">{"".join(options)}</select>
<p><img class="qr" id="qr" src="{watch_dir.name}/{qr0}" alt="Install QR code for the chosen watch"></p>
<p><a id="pkg" href="{watch_dir.name}/{pkg0}">{pkg0}</a></p>
<script>
document.getElementById('model').addEventListener('change', (e) => {{
  const o = e.target.selectedOptions[0];
  document.getElementById('qr').src = '{watch_dir.name}/' + o.dataset.qr;
  const a = document.getElementById('pkg'); a.href = '{watch_dir.name}/' + o.value; a.textContent = o.value;
}});
</script>'''
