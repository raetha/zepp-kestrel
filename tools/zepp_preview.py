#!/usr/bin/env python3
"""Upload a build to Zepp's developer preview service, like `zeus preview` does.

Why: it's Zepp's own route for putting a development build on a watch (`zeus preview`),
so the Zepp app may treat the side service differently from a QR code for our own .zpk:
on an iPhone, installing our .zpk over an existing install updated the watch but kept an
old side service. (It gave no Settings page either when tried in October 2026.)
Optional: CI runs it only when the three secrets are set.

The upload is tied to the developer's Zepp account. CI reads the login from three
secrets (see docs/development.md -> "Preview installs"):

  ZEPP_APPTOKEN, ZEPP_USERID, ZEPP_CNAME

Restored from git history (removed in 12e821c).

  python3 tools/zepp_preview.py <dist dir with one .zab> <out dir> [--device-source N]

Like `zeus preview`, it uploads a bundle holding only the chosen watch's package
(default: Amazfit Balance 3, 11141376). The intermediate products (.ip-package) stay:
Zepp's upload service rejects a bundle without them.

Writes <out>/preview-url.txt (the zpkd1:// style URL Zepp returns), <out>/preview-qr.png
and <out>/preview-expires.txt. Zepp keeps preview packages for 7 days, so CI uploads a
fresh one on every push to dev.

Mirrors @zeppos/zeus-cli 1.9.3 (zeppos-app-utils api.uploadPackage and
modules.previewBuild).
"""
import io
import json
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_qr import make  # noqa: E402


def fail(msg):
    # ::error:: shows as a run annotation (readable without the log); GitHub masks secrets in it
    print(f"::error title=Zepp preview upload::{msg}")
    sys.exit(1)


args = [a for a in sys.argv[1:] if not a.startswith("--device-source")]
dist, out = Path(args[0]), Path(args[1])
device_source = 11141376
for a in sys.argv[1:]:
    if a.startswith("--device-source="):
        device_source = int(a.split("=", 1)[1])
# Values copied out of the login callback URL may still be URL-encoded (%2C and so on).
token = unquote(os.environ.get("ZEPP_APPTOKEN", "").strip())
userid = unquote(os.environ.get("ZEPP_USERID", "").strip())
cname = unquote(os.environ.get("ZEPP_CNAME", "").strip())
if not (token and userid and cname):
    fail("ZEPP_APPTOKEN, ZEPP_USERID and ZEPP_CNAME must all be set")
# cname is a comma-separated list of the account's regional hosts; like zeus, use the
# api-mifit one (zeus-cli utils/pre-check.js initVariable).
hosts = [h.strip().removeprefix("https://").removeprefix("http://").strip("/") for h in cname.split(",")]
host = next((h for h in hosts if "api-mifit" in h), None)
if not host:
    fail(f"ZEPP_CNAME has no api-mifit host ({len(hosts)} entries); copy the whole cname value again")

zabs = sorted(dist.glob("*.zab"))
if len(zabs) != 1:
    fail(f"expected exactly one .zab in {dist}, found {len(zabs)}")



def single_device_zab(zab_path, source):
    """The .zab with only the package for one watch, as zeus preview builds it."""
    with zipfile.ZipFile(zab_path) as zab:
        manifest = json.loads(zab.read("manifest.json"))
        names = zab.namelist()
        ip = zab.read(".ip-package") if ".ip-package" in names else None
        keep = None
        for entry in manifest["zpks"]:
            zpk = zab.read(entry["name"])
            with zipfile.ZipFile(io.BytesIO(zpk)) as z, zipfile.ZipFile(io.BytesIO(z.read("device.zip"))) as d:
                sources = [p.get("deviceSource") for p in json.loads(d.read("app.json")).get("platforms", [])]
            if source in sources:
                keep = (entry, zpk)
                break
    if keep is None:
        fail(f"no package in {zab_path.name} targets deviceSource {source}")
    manifest["zpks"] = [keep[0]]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(keep[0]["name"], keep[1])
        if ".ip-package" in names:    # Zepp's upload service requires it (HTTP 500 without)
            z.writestr(".ip-package", ip)
        z.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
    return buf.getvalue()


payload = single_device_zab(zabs[0], device_source)
try:
    res = requests.post(
        f"https://{host}/custom/tools/app-dial/upload",
        params={"userid": userid},
        headers={"apptoken": token},
        files={"file": (zabs[0].name, payload, "application/octet-stream")},
        data={"app_type": "2"},          # 1 = watch face, 2 = app
        timeout=120,
    )
except requests.RequestException as e:
    fail(f"could not reach the Zepp host from ZEPP_CNAME ({type(e).__name__}: {e})")
if res.status_code == 401:
    fail("Zepp rejected the login (401): the token has expired. Log in again and update ZEPP_APPTOKEN.")
if res.status_code != 200:
    fail(f"upload failed: HTTP {res.status_code}: {res.text[:300]}")
try:
    body = res.json()
except ValueError:
    fail(f"upload returned non-JSON: {res.text[:300]}")
data = body.get("data", body) if isinstance(body, dict) else {}
protocol, code = data.get("protocol"), data.get("code")
if not (protocol and code):
    fail(f"unexpected response from Zepp: {str(body)[:300]}")

url = f"{protocol}://{host}/custom/tools/app-dial/download/{code}"
expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d %H:%M UTC")
out.mkdir(parents=True, exist_ok=True)
(out / "preview-url.txt").write_text(url + "\n")
(out / "preview-expires.txt").write_text(expires + "\n")
make(out / "preview-qr.png", url)
print(f"preview uploaded; expires {expires}")
