"""Constants for the Kestrel integration."""

DOMAIN = "kestrel"
NAME = "Kestrel"

SIDE_HEADER = "X-Kestrel-Side"  # the phone side's build, sent with every request (Phone app version)
TOKEN_HEADER = "X-Kestrel-Token"
EVENT_FIRED = "kestrel_fired"
EVENT_PROBE = "kestrel_probe"  # M0 measurement results from a watch

PAIRING_TTL = 600  # seconds a pairing code stays valid
PAIRING_MAX_ATTEMPTS = 5  # wrong codes before a pairing is cancelled
PAIR_STARTS_PER_WINDOW = 10  # pairing requests per client address per window
PAIR_WINDOW = 600
PAIRINGS_PENDING_MAX = 5  # pairings waiting for their code at once (each shows a notification)
WATCH_NAME_MAX = 40
PROBE_MAX_BYTES = 100_000  # one probe result; a trail or aim trace is a few kB
PROBES_MAX_CHARS = 2_000_000  # all kept probe results together (they're rewritten to disk as one file)

STORAGE_KEY = "kestrel.watches"
STORAGE_VERSION = 1
PROBES_STORAGE_KEY = "kestrel.probes"  # recent probe results, for diagnostics downloads
PROBES_KEPT = 500
PROBES_MAX_AGE = 14 * 86400  # seconds: older probe results are dropped
PHONE_NOT_REPORTED = "older (not reported)"  # Phone app version when the side service doesn't send its build
TAKE_OVER_WINDOW = 600  # seconds after pairing in which a watch may take over another setup
REMOVED_KEPT_DAYS = 30  # a removed watch's paints, rooms and settings, offered to the next watch that pairs
DETAILED_DIAGNOSTICS_FOR = 7 * 86400  # seconds: detailed diagnostics turn themselves off after this
# Recorded by the watch as it's used (not run on purpose from Probes): kept only with detailed
# diagnostics on (a trail also when it holds an error), and never fired as kestrel_probe events,
# so Home Assistant's event history doesn't fill with aim traces.
AUTO_PROBES = ("point", "trail", "room", "paint")
PROBES_SAVE_DELAY = 10  # seconds; probe results arrive in bursts
STATUS_SAVE_DELAY = 30  # seconds; what watches report (last seen, room...) is saved lazily
SEEN_EVERY = 60  # seconds; "last seen" moves on at most this often

SIGNAL_WATCH_ADDED = f"{DOMAIN}_watch_added"  # a watch paired: add its entities


def signal_watch_updated(watch_id: str) -> str:
    """Dispatcher signal: a watch's status, settings, paints or rooms changed."""
    return f"{DOMAIN}_watch_updated_{watch_id}"


SUPPORTED_DOMAINS = (
    "light",
    "switch",
    "fan",
    "media_player",
    "lock",
    "cover",
    "climate",
    "scene",
    "script",
    "button",
    "input_button",
    "input_boolean",
)
# Run, not toggle: these make good "virtual spots" (point at the sofa: movie scene).
ACTION_DOMAINS = ("scene", "script", "button", "input_button")
VOLUME_MIN_INTERVAL = 1.0  # seconds between two volume twists from one watch
# Domains where a gesture alone never acts: the watch must send confirmed=true.
CONFIRM_DOMAINS = ("lock",)
