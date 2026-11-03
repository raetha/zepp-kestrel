#!/usr/bin/env python3
"""Write the README's watch table from watch/models.json (between the models:start/end markers).

  python3 tools/models_table.py          # update README.md
  python3 tools/models_table.py --check  # fail if README.md is out of date (CI)
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STATUS = {
    "tested": "Works (tested on the watch)",
    "emulator": "Runs in the emulator",
    "untested": "Should work (not checked)",
    "unsupported": "Not supported",
}
START, END = "<!-- models:start -->", "<!-- models:end -->"


def table() -> str:
    data = json.loads((REPO / "watch" / "models.json").read_text())
    rows = ["| Watch | Screen | API | Kestrel | Compass | Gyroscope | Notes |", "| --- | --- | --- | --- | --- | --- | --- |"]
    order = list(STATUS)
    for m in sorted(data["models"], key=lambda m: order.index(m["status"])):
        rows.append(
            f"| {m['name']} | {m['screen']} | {m.get('api') or '< 3.6'} | {STATUS[m['status']]} | "
            f"{m.get('compass') or '–'} | {m.get('gyro') or '–'} | {m.get('note') or ''} |"
        )
    return "\n".join(rows) + f"\n\nChecked {data['checked']}. Compass and gyroscope are from the watches' specifications (\"not confirmed\": not found in them).\n"


readme = REPO / "README.md"
text = readme.read_text()
head, rest = text.split(START, 1)
_, tail = rest.split(END, 1)
new = f"{head}{START}\n{table()}{END}{tail}"
if "--check" in sys.argv:
    sys.exit(0 if new == text else "README.md's watch table is out of date: run python3 tools/models_table.py")
readme.write_text(new)
print("README.md updated")
