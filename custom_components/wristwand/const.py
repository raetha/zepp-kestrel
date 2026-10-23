"""Constants for the WristWand integration."""

DOMAIN = "wristwand"
NAME = "WristWand"

TOKEN_HEADER = "X-WristWand-Token"
EVENT_FIRED = "wristwand_fired"
EVENT_PROBE = "wristwand_probe"  # M0 measurement results from a watch
LABEL_NAME = "wristwand"  # entities (or their devices) with this label are offered to watches

PAIRING_TTL = 600  # seconds a pairing code stays valid
PAIRING_MAX_ATTEMPTS = 5  # wrong codes before a pairing is cancelled
PAIR_STARTS_PER_WINDOW = 10  # pairing requests per client address per window
PAIR_WINDOW = 600

STORAGE_KEY = "wristwand.watches"
STORAGE_VERSION = 1
PROBES_STORAGE_KEY = "wristwand.probes"  # recent probe results, for diagnostics downloads
PROBES_KEPT = 500
PROBES_SAVE_DELAY = 10  # seconds; probe results arrive in bursts

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
