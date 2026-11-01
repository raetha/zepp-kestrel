#!/usr/bin/env python3
"""Drive `zeus bridge` (an interactive prompt) from a script, in a pseudo-terminal.

Waits for the bridge prompt, connects to the online Zepp app (retrying while the
app's bridge connection shows up), runs `install -t <device>`, then reports what the
Zepp app answered. Run by tools/zeus_bridge.sh in the project directory.

  python3 tools/zeus_bridge_drive.py "<Zeus device name>"
"""
import os
import pty
import re
import select
import sys
import time

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
device = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execvp("zeus", ["zeus", "bridge"])

seen = ""  # everything Zeus printed, without colours


def read(seconds):
    """Collect output for up to `seconds` (less if nothing more comes for a while)."""
    global seen
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.5)
        if not r:
            continue
        try:
            chunk = os.read(fd, 65536).decode(errors="replace")
        except OSError:
            return False
        if "login page has been opened" in chunk:
            print("::error title=Zeus bridge::Zepp refused the login: it has expired. Log in again and update ZEPP_APPTOKEN.")
            sys.exit(1)
        text = ANSI.sub("", chunk).replace("\r", "")
        seen += text
        sys.stdout.write(text)
        sys.stdout.flush()
    return True


def wait_for(pattern, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if re.search(pattern, seen):
            return True
        if not read(1):
            return False
    return bool(re.search(pattern, seen))


def send(line):
    print(f"\n>>> {line}")
    os.write(fd, (line + "\r").encode())


if not wait_for(r"bridge\$", 90):
    print("::error title=Zeus bridge::no bridge prompt (Zepp's bridge server unreachable?)")
    sys.exit(1)
connected = False
for _ in range(12):  # the list of online Zepp apps arrives a moment after the prompt
    mark = len(seen)
    send("connect")
    read(5)
    if "successfully connected" in seen[mark:]:
        connected = True
        break
if not connected:
    print("::error title=Zeus bridge::no Zepp app online: in the Zepp app, Profile -> your watch -> Developer Mode -> Bridge, then run this again")
    sys.exit(1)
mark = len(seen)
send(f'install -t "{device}"')
# Zeus builds, uploads, then pushes the package to the Zepp app; its replies are logged as they come
wait_for(r"(?s)(QR code|getting package).*", 600)
read(120)
send("exit")
read(5)
print("\n--- Zepp app replies after install ---")
print("\n".join(line for line in seen[mark:].splitlines() if line.strip())[-4000:])
