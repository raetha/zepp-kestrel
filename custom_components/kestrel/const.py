"""Constants for the Kestrel integration."""

DOMAIN = "kestrel"
NAME = "Kestrel"

TOKEN_HEADER = "X-Kestrel-Token"
EVENT_FIRED = "kestrel_fired"
EVENT_PROBE = "kestrel_probe"  # M0 measurement results from a watch
LABEL_NAME = "kestrel"  # entities (or their devices) with this label are offered to watches

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
    "input_boolean",
)
# Domains where a gesture alone never acts: the watch must send confirmed=true.
CONFIRM_DOMAINS = ("lock",)
