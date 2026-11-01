#!/usr/bin/env python3
"""The install pages' "pick your watch" part: zepp-devkit's picker() over watch/models.json.

  from model_picker import picker
  html = picker(site / "dev" / "watch", "raetha.github.io/zepp-kestrel/dev/watch", default="Balance 3")
"""
import json
import sys
from pathlib import Path

from zepp_devkit.packages import picker as _picker

sys.path.insert(0, str(Path(__file__).resolve().parent))
from components import REPO  # noqa: E402


def models():
    return json.loads((REPO / "watch" / "models.json").read_text())["models"]


def picker(watch_dir: Path, url_base: str, default: str = "Balance 3") -> str:
    return _picker(watch_dir, url_base, models(), default, colour="#1E1640")
