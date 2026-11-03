#!/usr/bin/env python3
"""The release install QR code for the Zepp app's developer-mode scanner (zepp-devkit qr).

  python3 tools/make_qr.py                 # watch/docs/install-qr.png -> zpkd1://raetha.github.io/zepp-kestrel/watch/kestrel.zpk
  python3 tools/make_qr.py <out.png> <url> # any other
"""
import sys
from pathlib import Path

from zepp_devkit.qr import make as _make

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import PAGES, REPO, WATCH_ZPK  # noqa: E402

COLOUR = "#1E1640"


def make(out, url):
    print(f"{_make(out, url, COLOUR)}  ->  {url}")


if __name__ == "__main__":
    if len(sys.argv) > 2:
        make(sys.argv[1], sys.argv[2])
    else:
        make(REPO / "watch" / "docs" / "install-qr.png", f"zpkd1://{PAGES}/watch/{WATCH_ZPK}")
