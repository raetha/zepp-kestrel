#!/usr/bin/env python3
"""Assemble the GitHub Pages install site.

Expects site/watch/kestrel.zpk (the latest watch release, downloaded by CI) and
site/watch/version.txt when a release exists. Before the first release the page says so
and points nowhere else (test builds are on the unlisted /dev/ page).

  python3 tools/build_site.py site
"""
import html
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import GITHUB, REPO, WATCH_ZPK, watch_meta  # noqa: E402

site = Path(sys.argv[1] if len(sys.argv) > 1 else "site")
meta = watch_meta()
watch = site / "watch"
if (watch / WATCH_ZPK).exists():
    version = (watch / "version.txt").read_text().strip()
    shutil.copy(REPO / "watch" / "docs" / "install-qr.png", watch / "install-qr.png")
    shutil.copy(REPO / "watch" / "docs" / "screenshot-menu.png", watch / "preview.png")
    body = f'''
  <section>
    <h2>{html.escape(meta["appName"])}</h2>
    <p class="ver">v{html.escape(version)}</p>
    <div class="row">
      <img class="face" src="watch/preview.png" alt="{html.escape(meta["appName"])} on the watch">
      <img class="qr" src="watch/install-qr.png" alt="Install QR code for {html.escape(meta["appName"])}">
    </div>
    <p><a href="watch/{WATCH_ZPK}">Download {WATCH_ZPK}</a></p>
  </section>'''
else:
    body = '<section><p>No release yet. Follow the project on GitHub to hear about the first one.</p></section>'

(site / "index.html").write_text(f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kestrel</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; font-family: system-ui, sans-serif; background: #0e0b1a; color: #ece9f6; }}
  main {{ max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; text-align: center; }}
  h1 {{ font-weight: 600; }}
  h2 {{ margin-bottom: 0; color: #a995ff; }}
  .ver {{ margin-top: 4px; color: #9890b0; }}
  section {{ border-top: 1px solid #241d3a; padding-top: 24px; margin-top: 24px; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; align-items: center; }}
  img.face {{ width: 240px; max-width: 80vw; border-radius: 50%; }}
  img.qr {{ width: 200px; max-width: 70vw; background: #fff; padding: 8px; border-radius: 8px; }}
  ol {{ text-align: left; display: inline-block; line-height: 1.6; }}
  a {{ color: #9fd4ff; }}
</style>
</head>
<body>
<main>
  <h1>Kestrel</h1>
  <p>Point your Amazfit watch at a smart-home device and trigger it, with Home Assistant.</p>
  <ol>
    <li>In the Zepp app, turn on Developer Mode: Profile → Settings → About, tap the Zepp logo 7 times.</li>
    <li>Profile → your watch → Developer Mode → tap the scan icon (top right).</li>
    <li>Scan the QR code and confirm the install.</li>
    <li>Open Kestrel's settings in the Zepp app and enter your Home Assistant URL and token.</li>
  </ol>
  {body}
  <p style="margin-top:40px"><a href="{GITHUB}">Source on GitHub</a></p>
</main>
</body>
</html>
''')
print("site ready")
