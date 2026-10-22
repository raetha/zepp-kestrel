#!/usr/bin/env python3
"""Add the unlisted test-build page to the Pages site.

Expects site/dev/watch/wristwand.zpk (a fresh test build). Writes its QR code and
site/dev/index.html. The page is not linked from the main site and is marked noindex;
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

site, sha, build = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
dev = site / "dev"
cards = []
if (dev / "watch" / WATCH_ZPK).exists():
    make(dev / "watch" / "install-qr.png", f"zpkd1://{PAGES}/dev/watch/{WATCH_ZPK}")
    meta = watch_meta()
    cards.append(f'''<section><h2>{html.escape(meta["appName"])} DEV</h2>
<p>based on {html.escape(meta["version"]["name"])} · build {html.escape(build)} · {html.escape(sha)}</p>
<img class="qr" src="watch/install-qr.png" alt="QR code for the WristWand test build">
<p><a href="watch/{WATCH_ZPK}">{WATCH_ZPK}</a></p></section>''')
stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
dev.mkdir(parents=True, exist_ok=True)
(dev / "index.html").write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>WristWand test builds</title>
<style>:root{{color-scheme:dark}}body{{margin:0;font-family:system-ui,sans-serif;background:#0e0b1a;color:#ece9f6;text-align:center}}
main{{max-width:640px;margin:0 auto;padding:24px 16px}}h2{{color:#a995ff;margin-bottom:4px}}p{{color:#a69fbe}}
img.qr{{width:220px;max-width:70vw;background:#fff;padding:8px;border-radius:8px}}a{{color:#9fd4ff}}
section{{border-top:1px solid #241d3a;margin-top:20px;padding-top:12px}}</style></head>
<body><main><h1>Test builds</h1>
<p>Tip of dev ({html.escape(sha)}, {stamp}). The test build installs next to the released app as a
separate "WristWand DEV" app with its own settings in the Zepp app.
GitHub Pages can cache files for up to 10 minutes after a push.</p>
{"".join(cards)}
</main></body></html>
''')
(site / "robots.txt").write_text("User-agent: *\nDisallow: /dev/\n")
print(f"dev page with {len(cards)} build(s)")
