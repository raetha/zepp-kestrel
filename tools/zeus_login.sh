# Sourced by tools/zeus_preview.sh and tools/zeus_bridge.sh: put the developer login
# (ZEPP_APPTOKEN, ZEPP_USERID, ZEPP_CNAME; docs/development.md -> "Preview installs") into
# Zeus's own login file (~/.zepp/.zeus), as `zeus login` would, only until the script ends.
dec() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]).strip())' "$1"; }
token="$(dec "${ZEPP_APPTOKEN:?}")"; userid="$(dec "${ZEPP_USERID:?}")"; cname="$(dec "${ZEPP_CNAME:?}")"
# GitHub masks the secrets as stored; mask the decoded forms too, should anything print them
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$token"; echo "::add-mask::$userid"; fi
login="$HOME/.zepp/.zeus"
mkdir -p "$HOME/.zepp"
touch "$login" && chmod 600 "$login"
saved="$(mktemp)" && cp "$login" "$saved"
# the login lives in this file only while zeus runs (the runner is thrown away anyway)
trap 'cp "$saved" "$login"; rm -f "$saved"' EXIT
# Zeus writes this file itself (version checks) without a final newline: start on a new line,
# or the first key is glued to its last line and Zeus asks for a login (seen in CI)
echo >> "$login"
{
  echo "____user_zepp_com__token=\"$token\""
  echo "____user_zepp_com__userid=\"$userid\""
  echo "____user_zepp_com__cname=\"$cname\""
} >> "$login"
unset token userid cname
