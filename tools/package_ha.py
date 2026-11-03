#!/usr/bin/env python3
"""Build kestrel.zip, the release asset HACS installs (hacs.json's zip_release).

  python3 tools/package_ha.py <zip> [--version <version>]

The integration's files go at the zip's root, since HACS extracts the zip into
custom_components/kestrel/. --version stamps a test build's version into the zip's
manifest.json, so Home Assistant and diagnostics show which build is installed.
"""
import argparse
import re
import zipfile
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "custom_components" / "kestrel"
_VERSION_LINE = re.compile(r'^(  "version": )"[^"]*"', re.MULTILINE)


def stamp_version(manifest: str, version: str) -> str:
    """Set manifest.json's version, keeping the file's own key order and layout."""
    stamped, count = _VERSION_LINE.subn(rf'\1"{version}"', manifest)
    if count != 1:
        raise ValueError("manifest.json has no single version line")
    return stamped


def package(target: Path, version: str | None = None, source: Path = SOURCE) -> list[str]:
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            relative = path.relative_to(source)
            if path.is_dir() or "__pycache__" in relative.parts or path.suffix == ".pyc":
                continue
            if relative.as_posix() == "manifest.json" and version is not None:
                archive.writestr("manifest.json", stamp_version(path.read_text(encoding="utf-8"), version))
            else:
                archive.write(path, relative.as_posix())
        return archive.namelist()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", type=Path)
    ap.add_argument("--version")
    args = ap.parse_args()
    names = package(args.zip, args.version)
    print(f"{args.zip}: {len(names)} files" + (f", version {args.version}" if args.version else ""))
