#!/usr/bin/env bash
# Install a test build on the watch through Zeus's bridge (`zeus bridge`, then `connect`
# and `install`): Zepp's other sanctioned way to put a development build on a watch. It
# goes through Zepp's servers to the Zepp app (Developer Mode -> Bridge turned on), no
# cable. An experiment: does it replace the phone side, which a preview install doesn't?
#
#   tools/zeus_bridge.sh <project dir> "<Zeus device name>"
#
# Needs ZEPP_APPTOKEN, ZEPP_USERID and ZEPP_CNAME, like tools/zeus_preview.sh.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
proj="$1"; device="$2"
source "$root/tools/zeus_login.sh"
cd "$proj"
python3 "$root/tools/zeus_bridge_drive.py" "$device"
