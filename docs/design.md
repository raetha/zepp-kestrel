# Design

The full design plan, with diagrams, is the shared "Wristwand — Design Plan" doc. This file keeps the decisions the code depends on.

## The idea

Paint a device once (sweep your arm across it for about 15 seconds), then point at it and trigger (snap, flick, button or tap) to toggle it. A twist dims lights. Locks always need a confirming tap.

## Architecture

- **Watch** (`watch/`, Zepp OS device app): sensors, aim classification, triggers, room detection, haptics. Everything time-critical runs here, so aiming never waits on Bluetooth.
- **Phone** (`watch/app-side/`, side service in the Zepp app): the only part that talks to Home Assistant. The watch sends `{seq, target, action}`; the phone de-duplicates by `seq` and calls HA.
- **Settings page** (`watch/setting/`, in the Zepp app): HA URL and token for direct mode. Only store installs get it (sideloaded apps don't), and it never leaves the phone.
- **Home Assistant**: the `wristwand` component (component mode, pairing), or nothing installed (direct mode, store installs with the Settings page).

## Pairing

Sideloaded apps get no Settings page in the Zepp app, and typing a Nabu Casa address or a token on a watch is impractical, so the watch pairs with the component instead:

1. **Find.** The phone tries `http://homeassistant.local:8123`, `http://homeassistant:8123` and `https://homeassistant.local:8123` (plus any saved address) for `GET /api/wristwand/info`. iOS resolves `.local` names itself, so this works on the home Wi-Fi with nothing typed. (Neither the watch nor the phone side has an mDNS API of its own.)
2. **Code.** The watch asks HA to pair (`POST /api/wristwand/pair` with its name). HA shows a 6-digit code as a notification, valid 10 minutes. Requests are rate-limited per address.
3. **Confirm.** The code is typed on the watch's keypad (`POST /api/wristwand/pair/confirm`). Five wrong codes cancel the pairing. HA answers with a token for this watch (stored hashed in HA), its own name, and its internal and external (Nabu Casa) URLs.
4. **Use.** The phone keeps the token and every address; each request tries the last one that worked, then local ones, then remote, so it keeps working away from home. The token only works on `/api/wristwand/*` (sent as `X-WristWand-Token`, not `Authorization`, so HA's login ban never counts it). A 401 means the watch was removed in HA: the phone forgets the pairing.

A store install can still type a URL in the Settings page and pair with a code, or use direct mode with a token.

## Home Assistant: two modes

The side service calls `GET /api/wristwand/info` at startup; a 404 means direct mode. The watch code is the same in both.

| What | Direct mode | Component mode |
| --- | --- | --- |
| What you can paint | Entities | Targets: an entity, a script, or a virtual target that only fires an event |
| What a trigger does | Fixed per-domain action | Per-target action, set in the HA UI |
| Automations | Wrap logic in scripts | `wristwand_fired` event and device triggers |
| Safety | Enforced on the watch | Enforced in HA: confirm-required domains, away mode, per-user allow lists |
| Paint data | Watch, backed up to the phone | Also stored in HA, so a new or reset watch restores quickly |
| Room | Watch Bluetooth fingerprint | Watch fingerprint, or HA presence (Bermuda, ESPHome proxies, room sensors) |
| Round trip | Service call | `POST /api/wristwand/fire` returns the new state |
| Setup | Settings page: URL + long-lived token (store installs only) | Pairing code; nothing to copy |

Direct mode filters entities with an HA label `wristwand` (all supported entities if no entity has it) and groups them by Area; entities without an Area show under "Unassigned".

## Pointing model

- Aim = the forearm's compass heading plus its pitch, from the accelerometer's gravity vector and the compass (`attitude()` in `watch/lib/aim.js`). The forearm runs along the watch's 3–9 o'clock axis (x), and the compass reports where 12 o'clock points, so the heading is corrected for that and for wrist roll. Roll is also used for the dimming twist.
- Aim gate: the arm must be still (gyro under about 30°/s for 300 ms), pitch within ±70°, roll within ±50° (beyond that 12 o'clock points too steeply for its compass heading to mean much), compass calibrated. The limits are symmetric, so the left wrist works without a setting.
- A paint stores, per device and room, one or more spots: circular mean heading and spread, mean pitch and spread, and up to 60 samples. Heading maths is always circular (`lib/circular.js`).
- Classification scores each spot with a 2D Gaussian; states are resting, aiming, candidate (show the name) and locked (margin over the runner-up). A wrong guess offers the runner-up; corrections reweight spots.

## Triggers

Pluggable: `start()`, `stop()`, `onFire(cb)`. Snap (accelerometer spike), wrist flick (gyro burst), physical button, screen tap. M0 decides the default from measured sensor rates and recordings. With motion sensors at 25 Hz (see below), a snap is recognised by the wrist movement that comes with it, not by its click, so gesture triggers are calibrated per person on the watch: record your gesture a few times and some ordinary movement, and the watch sets its own thresholds.

## What the real watch measured (M0, Balance 3)

- **Motion sensors: 25 Hz.** The accelerometer and gyro deliver about 25 readings a second even in HIGH mode (snap recordings). Zepp OS has no batched or faster API. A finger snap's click lasts about 10 ms and falls between readings; the wrist's turn during a snap (a gyro swing of roughly 200°/s over 200 ms) does show.
- **Axes.** Raising and lowering the arm moves gravity along x, so the forearm is the 3–9 o'clock axis (y, 12 o'clock, points across the wrist).
- **Compass.** Apps get the heading of 12 o'clock (`getDirectionAngle()`), at about 2 readings a second by default (faster modes from API 4.0), and no raw magnetic field. Whether that heading is tilt-compensated is being measured (Compass tilt probe). If it isn't, aim will steer with the gyro between compass readings taken with the arm level.
- **Latency.** Watch ↔ phone over Bluetooth: median 0.6 s, 90th percentile 0.9 s. Phone ↔ Home Assistant: median 0.12 s (over a VPN). Bluetooth dominates, so the watch buzzes as soon as a command is sent rather than waiting for the result.

## Milestones

1. **M0 Spike**: measurement probes (this build).
2. **M1 One lamp**: settings, side service, entity sync, paint one device, button trigger, haptic acknowledgement.
3. **M2 Whole room**: classifier, aim states, corrections, the optional HA component, recorder and replay tests.
4. **M3 Whole house**: room fingerprints, snap and flick, lock confirmation, dimming, away mode.
5. **M4 Ship it**: polish, battery, other round Zepp watches, first release.
