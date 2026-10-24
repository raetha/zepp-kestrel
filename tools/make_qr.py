#!/usr/bin/env python3
"""Make an install QR code for the Zepp app's developer-mode scanner.

The Zepp app accepts `zpkd1://<host>/<path>.zpk` and downloads the package over HTTPS.
CI publishes packages to GitHub Pages at fixed URLs, so the codes never change:

  release   zpkd1://raetha.github.io/zepp-kestrel/watch/kestrel.zpk   -> watch/docs/install-qr.png
  test      zpkd1://raetha.github.io/zepp-kestrel/dev/watch/kestrel.zpk

  python3 tools/make_qr.py                 # the committed release QR code
  python3 tools/make_qr.py <out.png> <url> # any other
"""
import sys
from pathlib import Path

import qrcode

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import PAGES, REPO, WATCH_ZPK  # noqa: E402


def make(out, url):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    qr.make_image(fill_color="#1E1640", back_color="white").save(out)
    print(f"{out}  ->  {url}")


if __name__ == "__main__":
    if len(sys.argv) > 2:
        make(sys.argv[1], sys.argv[2])
    else:
        make(REPO / "watch" / "docs" / "install-qr.png", f"zpkd1://{PAGES}/watch/{WATCH_ZPK}")
