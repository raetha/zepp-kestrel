#!/usr/bin/env python3
"""Read a component's CHANGELOG.md (watch/CHANGELOG.md, ha/CHANGELOG.md).

  python3 tools/changelog.py <component> <version>      # print that version's section

`section()` feeds the GitHub release notes (tools/release_notes.py); `to_html()` the
install page's "What's new" and the test page's "Changes since the last release".
"""
import html
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


def _inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', text)


def to_html(markdown):
    """A changelog section as HTML: paragraphs, ### headings and - bullets (all it uses)."""
    out, para, items = [], [], []

    def flush():
        if para:
            out.append(f"<p>{_inline(' '.join(para))}</p>")
            para.clear()
        if items:
            out.append("<ul>" + "".join(f"<li>{_inline(i)}</li>" for i in items) + "</ul>")
            items.clear()

    for line in markdown.splitlines():
        s = line.strip()
        if not s:
            flush()
        elif s.startswith("### "):
            flush()
            out.append(f"<h4>{_inline(s[4:])}</h4>")
        elif s.startswith("- "):
            if para:
                flush()
            items.append(s[2:])
        elif items:
            items[-1] += " " + s  # a bullet continued on the next line
        else:
            para.append(s)
    flush()
    return "\n".join(out)


if __name__ == "__main__":
    body = section(sys.argv[1], sys.argv[2])
    if body is None:
        sys.exit(f"{sys.argv[1]}/CHANGELOG.md has no section for [{sys.argv[2]}]")
    print(body)
