#!/usr/bin/env python3
"""Add the unlisted test-build page to the Pages site.

Expects site/dev/watch/kestrel.zpk (a fresh test build for the Balance 3) and, from
tools/packages.py, a package per screen and chip with packages.json. Writes the QR codes
(one per package, chosen by watch model: tools/model_picker.py) and site/dev/index.html. The page is not linked from the main site and is marked noindex;
its QR code never changes, so you can bookmark the page.

  python3 tools/dev_site.py site <short-sha> <build-number>

Adapted from raetha/zepp-watch-faces.
"""
import html
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import PAGES, WATCH_ZPK, watch_meta  # noqa: E402
from make_qr import make  # noqa: E402
from model_picker import picker  # noqa: E402

site, sha, build = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
dev = site / "dev"
cards = []
if (dev / "watch" / WATCH_ZPK).exists():
    w = dev / "watch"
    make(w / "install-qr.png", f"zpkd1://{PAGES}/dev/watch/{WATCH_ZPK}")
    meta = watch_meta()
    if (w / "packages.json").exists():
        primary = '''<p class="note">Pick your watch, then scan in the Zepp app: Profile → your watch → Developer Mode → scan.
Each watch needs the package built for its screen. The codes never change; they always install the newest build.</p>''' + picker(
            w, f"{PAGES}/dev/watch"
        ) + '''<p class="note">Balance 3: the original code (kestrel.zpk) keeps working too.</p>'''
    else:
        primary = '''<p class="note">Scan in the Zepp app: Profile → your watch → Developer Mode → scan.
The QR code never changes; it always installs the newest build.</p>
<img class="qr" src="watch/install-qr.png" alt="QR code for the Kestrel test build">'''
    if (w / "preview-qr.png").exists():
        # Zepp's preview service (tools/zeus_preview.sh, only with the ZEPP_* secrets): an experiment,
        # to see whether the Zepp app updates the side service for this route
        expires = (w / "preview-expires.txt").read_text().strip()
        variant_file = w / "preview-variant.txt"
        variant = variant_file.read_text().strip() if variant_file.exists() else "our copy of its upload"
        primary = f'''<h3>Zepp preview install (Balance 3 and 3 Ti)</h3>
<p class="note">Through Zepp's own preview service, as <code>zeus preview</code> does: the same Kestrel DEV app. Expires {html.escape(expires)};
each push to dev makes a new one. Scan it the same way. (Uploaded {html.escape(variant)}.)</p>
<img class="qr" src="watch/preview-qr.png" alt="QR code for the Kestrel test build through Zepp's preview service">
<h3>Our own packages</h3>''' + primary
    cards.append(f'''<section><h2>{html.escape(meta["appName"])} DEV</h2>
<p>based on {html.escape(meta["version"]["name"])} · build {html.escape(build)} · {html.escape(sha)}</p>
{primary}
<p class="note">All-watch bundle (the .zab format the Zepp store takes; this one carries the DEV app ID): <a href="watch/kestrel-dev.zab">kestrel-dev.zab</a></p></section>''')
stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
dev.mkdir(parents=True, exist_ok=True)
(dev / "index.html").write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Kestrel test builds</title>
<style>:root{{color-scheme:dark}}body{{margin:0;font-family:system-ui,sans-serif;background:#0e0b1a;color:#ece9f6;text-align:center}}
main{{max-width:640px;margin:0 auto;padding:24px 16px}}h2{{color:#a995ff;margin-bottom:4px}}p{{color:#a69fbe}}
img.qr{{width:220px;max-width:70vw;background:#fff;padding:8px;border-radius:8px}}img.small{{width:150px}}.note{{max-width:420px;margin:8px auto}}a{{color:#9fd4ff}}
select{{font-size:1rem;padding:6px;margin:8px;max-width:90vw}}section{{border-top:1px solid #241d3a;margin-top:20px;padding-top:12px}}</style></head>
<body><main><h1>Test builds</h1>
<p>Tip of dev ({html.escape(sha)}, {stamp}). The test build installs next to the released app as a
separate "Kestrel DEV" app with its own settings in the Zepp app.
GitHub Pages can cache files for up to 10 minutes after a push.</p>
{"".join(cards)}
</main></body></html>
''')
(site / "robots.txt").write_text("User-agent: *\nDisallow: /dev/\n")
print(f"dev page with {len(cards)} build(s)")
