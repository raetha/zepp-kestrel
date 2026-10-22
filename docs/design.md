# Design

The full design plan, with diagrams, is the shared "Wristwand — Design Plan" doc. This file keeps the decisions the code depends on.

## The idea

Paint a device once (sweep your arm across it for about 15 seconds), then point at it and trigger (snap, flick, button or tap) to toggle it. A twist dims lights. Locks always need a confirming tap.

## Architecture

- **Watch** (`watch/`, Zepp OS device app): sensors, aim classification, triggers, room detection, haptics. Everything time-critical runs here, so aiming never waits on Bluetooth.
- **Phone** (`watch/app-side/`, side service in the Zepp app): the only part that talks to Home Assistant. The watch sends `{seq, target, action}`; the phone de-duplicates by `seq` and calls HA.
- **Settings page** (`watch/setting/`, in the Zepp app): HA URL and token. The token never leaves the phone.
- **Home Assistant**: works with nothing installed (direct mode), and better with the optional `wristwand` custom component (component mode).

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

Direct mode filters entities with an HA label `wristwand` (all supported entities if no entity has it) and groups them by Area; entities without an Area show under "Unassigned".

## Pointing model

- Aim = compass heading (`getDirectionAngle()`) plus forearm pitch from the accelerometer's gravity vector. Roll is used for the dimming twist.
- Aim gate: the arm must be still (gyro under about 30°/s for 300 ms), pitch between −30° and +70°, compass calibrated.
- A paint stores, per device and room, one or more spots: circular mean heading and spread, mean pitch and spread, and up to 60 samples. Heading maths is always circular (`watch/lib/circular.js`).
- Classification scores each spot with a 2D Gaussian; states are resting, aiming, candidate (show the name) and locked (margin over the runner-up). A wrong guess offers the runner-up; corrections reweight spots.

## Triggers

Pluggable: `start()`, `stop()`, `onFire(cb)`. Snap (accelerometer spike), wrist flick (gyro burst), physical button, screen tap. M0 decides the default from measured sensor rates and recordings.

## Milestones

1. **M0 Spike**: measurement probes (this build).
2. **M1 One lamp**: settings, side service, entity sync, paint one device, button trigger, haptic acknowledgement.
3. **M2 Whole room**: classifier, aim states, corrections, the optional HA component, recorder and replay tests.
4. **M3 Whole house**: room fingerprints, snap and flick, lock confirmation, dimming, away mode.
5. **M4 Ship it**: polish, battery, other round Zepp watches, first release.
