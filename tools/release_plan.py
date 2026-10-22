#!/usr/bin/env python3
"""Work out which components need a release, and check every component's changelog.

A component is released when its version has no matching git tag (`<component>-v<version>`,
e.g. watch-v0.1.0). Components containing a DRAFT file are skipped entirely. Every other
component's current version must have a CHANGELOG.md section, so a version bump without
notes fails CI (also on pull requests).

  python3 tools/release_plan.py            # print the plan
  python3 tools/release_plan.py --github   # also write `releases=<json>` to $GITHUB_OUTPUT

Adapted from raetha/zepp-watch-faces.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from changelog import section  # noqa: E402
from components import REPO, components  # noqa: E402

tags = set(subprocess.run(["git", "tag", "-l"], capture_output=True, text=True, cwd=REPO).stdout.split())
plan, problems = [], []
for name, version, title, draft in components():
    if draft:
        print(f"{name}: draft, not released")
        continue
    tag = f"{name}-v{version}"
    if section(name, version) is None:
        problems.append(f"{name}/CHANGELOG.md needs a '## [{version}]' section (current version)")
    if tag not in tags:
        plan.append({"component": name, "version": version, "tag": tag, "title": f"{title} {version}"})
    print(f"{name}: version {version} -> {'RELEASE ' + tag if tag not in tags else 'already released'}")

if problems:
    print("\n".join(problems), file=sys.stderr)
    sys.exit(1)
if "--github" in sys.argv and os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"releases={json.dumps(plan)}\n")
