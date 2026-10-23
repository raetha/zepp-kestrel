#!/usr/bin/env python3
"""Upload a build to Zepp's developer preview service, like `zeus preview` does.

Why: the Zepp app only shows a mini program's Settings page when the app was installed
from Zepp's preview service under the developer's account. A QR code pointing at our
own .zpk installs the watch app and its side service, but no Settings page.

The upload is tied to the developer's Zepp account. CI reads the login from three
secrets (see docs/development.md -> "Preview installs"):

  ZEPP_APPTOKEN, ZEPP_USERID, ZEPP_CNAME

  python3 tools/zepp_preview.py <dist dir with one .zab> <out dir>

Writes <out>/preview-url.txt (the zpkd1:// style URL Zepp returns), <out>/preview-qr.png
and <out>/preview-expires.txt. Zepp keeps preview packages for 7 days, so CI uploads a
fresh one on every push to dev.

Mirrors @zeppos/zeus-cli 1.9.3 (zeppos-app-utils api.uploadPackage and
modules.previewBuild).
"""
import os
import sys
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


dist, out = Path(sys.argv[1]), Path(sys.argv[2])
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

try:
    with zabs[0].open("rb") as f:
        res = requests.post(
            f"https://{host}/custom/tools/app-dial/upload",
            params={"userid": userid},
            headers={"apptoken": token},
            files={"file": (zabs[0].name, f, "application/octet-stream")},
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
