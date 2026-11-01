#!/usr/bin/env python3
"""Add the unlisted test-build page to the Pages site.

Shows the Zepp preview QR code (zepp-devkit's preview action) when the build has one. Without it
(no ZEPP_* secrets), falls back to our own packages: site/dev/watch/kestrel.zpk and, from
zepp-devkit packages, a package per screen and chip with packages.json (one QR code per package,
chosen by watch model: tools/model_picker.py). Writes site/dev/index.html. The page is not linked from the main site and is marked noindex;
its QR code never changes, so you can bookmark the page.

  python3 tools/dev_site.py site <short-sha> <build-number>

Adapted from raetha/zepp-watch-faces.
"""
import html
import sys
from datetime import datetime, timezone
from pathlib import Path

from zepp_devkit.changelog import section as _section, to_html
from zepp_devkit.project import component as devkit_component

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import REPO, PAGES, WATCH_ZPK, watch_meta  # noqa: E402

from make_qr import make  # noqa: E402
from model_picker import picker  # noqa: E402


def section(name, version):
    """A component's changelog section (zepp-devkit.json lists where each changelog is)."""
    return _section(devkit_component(name, REPO).changelog, version)

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
        # Zepp's preview service (zepp-devkit's preview action, with the ZEPP_* secrets): the sanctioned way
        # to install a test build, and the only one that gets the Settings page. Our own .zpk codes
        # aren't shown then: they never did, and they left the Zepp app running an old phone side.
        expires = (w / "preview-expires.txt").read_text().strip()
        primary = f'''<p class="note">Balance 3 and 3 Ti. In the Zepp app: Profile → your watch → Developer Mode → + → Scan.
Installs Kestrel DEV with its Settings page (Developer Mode → Kestrel DEV → Settings). Expires {html.escape(expires)};
each push to dev makes a new code.</p>
<img class="qr" src="watch/preview-qr.png" alt="QR code for the Kestrel test build">
<p class="note">The iPhone Zepp app keeps running the phone part of the first build it installed, through later
installs (even after deleting the app): check Home Assistant's "Phone app version", and reinstall the Zepp app
if the phone part matters for a test.</p>'''
    else:
        # no preview upload (a fork without the ZEPP_* secrets, or a failed upload): our own packages
        primary = '''<p class="note">No Zepp preview this build (it needs the ZEPP_* secrets): these packages install the
watch app, but the Zepp app gives them no Settings page and may keep an older phone part.</p>''' + primary
    cards.append(f'''<section><h2>{html.escape(meta["appName"])} DEV</h2>
<p>based on {html.escape(meta["version"]["name"])} · build {html.escape(build)} · {html.escape(sha)}</p>
{primary}
<p class="note">All-watch bundle (the .zab format the Zepp store takes; this one carries the DEV app ID): <a href="watch/kestrel-dev.zab">kestrel-dev.zab</a></p></section>''')
for component, title in (("watch", "Watch app"), ("ha", "Home Assistant component")):
    notes = section(component, "Unreleased")
    if notes:
        cards.append(f'''<section class="notes"><h2>{title}: changes since the last release</h2>
{to_html(notes)}</section>''')
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
select{{font-size:1rem;padding:6px;margin:8px;max-width:90vw}}.notes{{text-align:left;line-height:1.5}}.notes h4{{color:#a995ff}}code{{background:#241d3a;padding:1px 4px;border-radius:4px}}section{{border-top:1px solid #241d3a;margin-top:20px;padding-top:12px}}</style></head>
<body><main><h1>Test builds</h1>
<p>Tip of dev ({html.escape(sha)}, {stamp}). The test build installs next to the released app as a
separate "Kestrel DEV" app with its own settings in the Zepp app.
GitHub Pages can cache files for up to 10 minutes after a push.</p>
{"".join(cards)}
</main></body></html>
''')
(site / "robots.txt").write_text("User-agent: *\nDisallow: /dev/\n")
print(f"dev page with {len(cards)} section(s)")
