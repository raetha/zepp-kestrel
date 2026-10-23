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

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_qr import make  # noqa: E402

dist, out = Path(sys.argv[1]), Path(sys.argv[2])
token = os.environ.get("ZEPP_APPTOKEN", "").strip()
userid = os.environ.get("ZEPP_USERID", "").strip()
host = os.environ.get("ZEPP_CNAME", "").strip()
if not (token and userid and host):
    sys.exit("ZEPP_APPTOKEN, ZEPP_USERID and ZEPP_CNAME must all be set")

zabs = sorted(dist.glob("*.zab"))
if len(zabs) != 1:
    sys.exit(f"expected exactly one .zab in {dist}, found {len(zabs)}")

with zabs[0].open("rb") as f:
    res = requests.post(
        f"https://{host}/custom/tools/app-dial/upload",
        params={"userid": userid},
        headers={"apptoken": token},
        files={"file": (zabs[0].name, f, "application/octet-stream")},
        data={"app_type": "2"},          # 1 = watch face, 2 = app
        timeout=120,
    )
if res.status_code == 401:
    sys.exit("Zepp rejected the login (401): the token has expired. Log in again and update ZEPP_APPTOKEN.")
res.raise_for_status()
body = res.json()
protocol, code = body.get("protocol"), body.get("code")
if not (protocol and code):
    sys.exit(f"unexpected response from Zepp: {body}")

url = f"{protocol}://{host}/custom/tools/app-dial/download/{code}"
expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d %H:%M UTC")
out.mkdir(parents=True, exist_ok=True)
(out / "preview-url.txt").write_text(url + "\n")
(out / "preview-expires.txt").write_text(expires + "\n")
make(out / "preview-qr.png", url)
print(f"preview uploaded; expires {expires}")
