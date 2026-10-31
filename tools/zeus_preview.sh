#!/usr/bin/env bash
# Upload a test build to Zepp's preview service with the real `zeus preview`, the way
# other Zepp OS projects whose previews show up under Developer Mode do it
# (docs/development.md -> "Preview installs"). Zeus builds the package itself in
# preview mode (no intermediate products) for the given watches only.
#
#   tools/zeus_preview.sh <project dir> <out dir> "<Zeus device names, comma-separated>"
#
# Needs ZEPP_APPTOKEN, ZEPP_USERID and ZEPP_CNAME (the developer login, see the guide):
# they're written into Zeus's own login file (~/.zepp/.zeus), as `zeus login` would.
# Writes <out>/preview-qr.png, preview-url.txt, preview-expires.txt, preview-variant.txt.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
proj="$1"; out="$2"; devices="$3"
dec() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]).strip())' "$1"; }
mkdir -p "$HOME/.zepp" "$out"
# Zeus writes this file itself (version checks) without a final newline: start on a new line,
# or the first key is glued to its last line and Zeus asks for a login (seen in CI)
echo >> "$HOME/.zepp/.zeus"
{
  echo "____user_zepp_com__token=\"$(dec "${ZEPP_APPTOKEN:?}")\""
  echo "____user_zepp_com__userid=\"$(dec "${ZEPP_USERID:?}")\""
  echo "____user_zepp_com__cname=\"$(dec "${ZEPP_CNAME:?}")\""
} >> "$HOME/.zepp/.zeus"
log="$(mktemp)"
# no terminal: an expired login would wait for a browser forever, hence the timeout
(cd "$proj" && NODE_OPTIONS="--require $root/tools/zeus_preview_hook.cjs" timeout ${ZEUS_TIMEOUT:-600} zeus preview -s -t "$devices" </dev/null >"$log" 2>&1) || true
url="$(tr '\r' '\n' <"$log" | grep -o 'KESTREL_PREVIEW_URL=.*' | head -1 | cut -d= -f2- || true)"
if [ -z "$url" ]; then
  tr '\r' '\n' <"$log" | grep -v '^\s*$' | tail -15
  if grep -q "login page has been opened" "$log"; then
    echo "::error title=Zepp preview::Zepp refused the login: it has expired. Log in again and update ZEPP_APPTOKEN."
  else
    echo "::error title=Zepp preview::zeus preview gave no QR code (log above)"
  fi
  exit 1
fi
echo "$url" > "$out/preview-url.txt"
date -u -d '+7 days' '+%Y-%m-%d %H:%M UTC' > "$out/preview-expires.txt"
echo "the real zeus preview ($devices)" > "$out/preview-variant.txt"
python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from make_qr import make; make(sys.argv[2], sys.argv[3])' "$root/tools" "$out/preview-qr.png" "$url"
echo "preview uploaded: $(cat "$out/preview-expires.txt")"
