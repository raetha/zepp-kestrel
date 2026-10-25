# Audits

Quality scale, performance and security reviews of every part of Kestrel: the
watch app (`watch/page`, `watch/lib`), the phone side service (`watch/app-side`,
`watch/lib/ha-client.js`), the settings page (`watch/setting`), the Home
Assistant integration (`custom_components/kestrel`) and CI. Repeat before each
release; record what changed.

## 2026-10-24

### Quality scale

All 54 rules (developers.home-assistant.io → Integration quality scale → Rules)
checked against the code; the result is in `custom_components/kestrel/quality_scale.yaml`.
Every rule is done or exempt with a reason; none is left to do.

Done in this audit:

- Documentation (README → "The Home Assistant integration"): use cases, supported
  devices and functions, events (triggers), automation examples, how data updates,
  known limitations, troubleshooting, removal.
- `action-exceptions`, `exception-translations`: entity actions on a watch that was
  unpaired raise a translated `HomeAssistantError`.
- `entity-device-class`: the instant-toggle delay is a duration.
- `entity-disabled-by-default`: the gesture threshold numbers.
- `strict-typing`: `mypy --strict` passes (`ha/mypy.ini`) and runs in CI. Home
  Assistant 2026.10 types forms with probatio (voluptuous is aliased to it); config
  flow schemas go through one loosely typed helper so 2026.1+ keeps working.
- Every setting the watch syncs has an entity or (for lists of entities) a
  Configure field.

Exempt, with reasons in the file: service actions (none of its own), polling and
`log-when-unavailable` (watches push), discovery (watches find Home Assistant),
reauthentication and reconfiguration (nothing to re-enter), async dependency and
web session (no library, no client).

### Performance

| Where | Finding | Outcome |
| --- | --- | --- |
| Watch storage | Every `get()` read the file from flash: a sync read the sync state a dozen times, and the device list (up to about 60 kB with 1000 entities) was re-read for every count shown. | Fixed: `page/kv.js` keeps each file's text in memory per page (pages don't overlap) and skips writes that change nothing. Checked on the emulator: data written on Home still reaches Rooms. |
| Watch trail | Each button press wrote the trail file three times (press, release, click). | Fixed: clicks only. |
| Watch, Point | Room check: a 3 s Bluetooth scan every 45 s while pointing. | Every 60 s. Only when rooms are calibrated on the watch (not with a Home Assistant room sensor). |
| Watch, Point | Aim loop at 10 Hz, sensors at 25 Hz: scoring is a few Gaussians per painted spot; widgets change only when the state does; the screen-on renewal is throttled to every 5 s; dwell and gesture detection are constant time. | Fine as is. |
| Watch ↔ phone | Sync sends only what changed (revisions and a device-list hash, about 60 bytes); the full device list moves only when it changes. | Fine as is. |
| Phone | Requests try the last address that worked first; an address Home Assistant refuses as not home is skipped. | Fine as is. |
| HA, triggering | Checking that a target is offered rebuilt the whole device list on every trigger. | Fixed: `is_offered()` checks the one entity and the labelled entries. A test compares it with the list in every label situation. |
| HA, probes | Kept probe results are rewritten to disk as one file; 500 large traces could make it several MB. | Fixed: also capped at 2 million characters together (oldest dropped). |
| HA, status | "Last seen" moves at most once a minute; status saves are delayed 30 s. | Fine as is. |

### Security

| Severity | Finding | Outcome |
| --- | --- | --- |
| High | Pairing worked from anywhere, including through Home Assistant Cloud. A stranger could keep starting pairings and guess codes (6 digits, 5 tries per pairing, 10 pairings per 10 minutes per address); a hit gives a watch token, which can trigger devices, locks included. | Fixed: pairing (start and confirm) only from the home network: not through Home Assistant Cloud, and only from private or loopback addresses. At most 5 pairings wait at once. |
| Medium | A watch token could trigger any supported entity that exists, including ones left out of the list, hidden or disabled ones, and devices' configuration entities. | Fixed: only what the watch is offered. |
| Low | The watch name (sent before pairing) went into the pairing notification as markdown, so it could carry links. | Fixed: letters, digits, spaces and `-_.'()` only, 40 characters. |
| Low | Probe results had no size limit: a paired watch could fill the probe store. | Fixed: 100 kB per result, 2 million characters kept in all. |
| Info | Watch tokens: 32 random bytes, stored only as SHA-256 hashes, compared in constant time; only valid on Kestrel's own endpoints; deleting the watch's device revokes it. | Fine. |
| Info | Every watch request is checked (paints, rooms and settings are cleaned field by field and capped). | Fine. |
| Info | `/api/kestrel/info` is unauthenticated (the phone needs it to find Home Assistant) and returns the location name and integration version. | Accepted. |
| Info | Behind a reverse proxy without `trusted_proxies`, every request looks local, so the home-network check can't tell. | Documented here; set up `trusted_proxies` for your proxy. |
| Info | On the phone, the watch token sits in the Zepp app's settings storage, like any Zepp app's settings. The settings page never shows a saved token. | Accepted (the platform offers nothing safer). |
| Info | Typed local addresses use plain HTTP on the home network, so the token crosses the LAN unencrypted. | Accepted for local use. |
| Info | Diagnostics contain Bluetooth MAC addresses of nearby devices (room calibration), the watch's address and person entity ids, but no tokens. | Accepted: needed to debug; diagnostics are only downloaded by the owner. |
| Info | The watch holds no secrets: the token lives on the phone. | Fine. |
| Info | CI: least-privilege `permissions`, actions pinned to commits (Dependabot proposes updates), no stored secrets (the Zepp preview tokens are gone), builds published over HTTPS. | Fine. |

## 2026-10-24, later: home network only

| Severity | Finding | Outcome |
| --- | --- | --- |
| High | A watch token worked from anywhere through Home Assistant Cloud: a lost phone or a copied token could switch things (locks included, with a confirm) from outside. | Fixed: every Kestrel endpoint (not just pairing) refuses requests through Home Assistant Cloud or from a public address. Pairing hands out only the home-network URL; the phone skips addresses Home Assistant refuses. Away mode, which existed for this, is gone. Use a VPN (WireGuard, Tailscale) to use Kestrel from outside. |
| Info | Direct mode (store installs without the integration: a URL and a long-lived token in the Zepp app) talked to Home Assistant's own API, so Kestrel couldn't hold it to the home network. | Fixed: direct mode removed; the integration is required, and the phone never holds a long-lived token. |
| Info | Which devices watches can use is now an explicit choice in Configure (devices and entities) rather than a label anyone with the label registry could change; `is_offered()` and `list_targets()` share one rule (`Offered`), tested against each other. | Fine. |

## 2026-10-24, full review before a week of testing

Everything changed since the audits above: colour screens, calibration dots, fewer buzzes, direct mode removed, close-device scoring, crowding and room hints, Open on Point, twist volume, virtual spots, the paint map, learning from use, square watches, per-watch packages and the emulator sweep.

### Quality scale

Still all 54 rules done or exempt. New entities (Open on Point, Learn from use, Volume limit, Volume change per twist, Paint map) have translations, icons and entity categories (configuration; the paint map is diagnostic); 70 component tests, 99% coverage, `mypy --strict` clean.

### Security

| Severity | Finding | Outcome |
| --- | --- | --- |
| Medium | A watch could send any action name; anything other than `dim` on a light was carried out as a toggle (a `dim` on a switch toggled it, and so would a made-up action). | Fixed: toggle anything offered, dim only lights, volume only media players; anything else is refused (400). Tested. |
| Info | Twist volume: Home Assistant, not the watch, enforces the limits (per twist, the ceiling, one twist a second per watch), so a modified watch app can't get round them. | Fine. |
| Info | The paint map is an SVG built from entity, area and room names: every name is escaped, and it holds no scripts or links. | Fine. |
| Info | Paints sent by a watch keep only known spot fields (numbers, room, kind); learned spots count towards the 12-spot cap per device. | Fine. |
| Info | Per-watch packages and the test page's watch list are static files built by CI from this repo; no secrets involved. | Fine. |

### Performance

| Where | Finding | Outcome |
| --- | --- | --- |
| Watch, Point | Learning: one vote per trigger after 5.5 s, a few dozen operations; room learning at most every 10 minutes per room. Scoring adds a division per device per tick. | Fine as is. |
| Watch, Point | A pending vote was cancelled when another device was triggered within 5.5 s. | Fixed: one pending vote per device. |
| Watch, aim without a gyroscope | Readings arriving in a burst made the tilt rate look huge, so the arm never counted as still. | Fixed: readings are treated as at least 20 ms apart. |
| Watch, Point | Compass calibration lost again within a second of being regained left the dots green and stopped counting. | Fixed: they start counting again. |
| HA, paint map | The picture's hash is recomputed on each update from the watch (a JSON dump of its paints, under 100 kB); the SVG is drawn only when asked for. | Fine as is. |

## 2026-10-25: diagnostics and privacy

| Severity | Finding | Outcome |
| --- | --- | --- |
| Medium | Diagnostics downloads (meant for public issues) held the Bluetooth addresses of every device the watch heard when calibrating rooms, neighbours' included, and the watch's and Home Assistant's network addresses. | Fixed: addresses redacted; Bluetooth addresses replaced by salted pseudonyms, consistent within one download and different in the next. Token hashes were already redacted; the token itself is never stored in Home Assistant. Tested. |
| Low | The watch sent debug-level records all the time: an aim trace with every trigger, every run's screen and button trail, raw room scans. Each also became a `kestrel_probe` event, so Home Assistant's event history grew with every trigger. | Fixed: only with Detailed diagnostics on (per watch, off after a week); without it only probes run on purpose and trails with an error are kept. Automatic records never become events. Results older than 14 days are dropped. |
| Info | The phone's settings storage kept a summary of every aim trace and trail. | Fixed: only of probes run on purpose. |
| Info | Logging: one info line when a watch pairs (its name and id); nothing else. | Fine. |
