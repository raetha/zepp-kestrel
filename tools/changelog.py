#!/usr/bin/env python3
"""Read a component's CHANGELOG.md (components: watch/, later ha/).

  python3 tools/changelog.py <component> <version>      # print that version's section
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def section(component, version):
    path = REPO / component / "CHANGELOG.md"
    if not path.exists():
        return None
    text = path.read_text()
    m = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)", text, re.S | re.M)
    return m.group(1).strip() if m else None


if __name__ == "__main__":
    body = section(sys.argv[1], sys.argv[2])
    if body is None:
        sys.exit(f"{sys.argv[1]}/CHANGELOG.md has no section for [{sys.argv[2]}]")
    print(body)
