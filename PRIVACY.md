# Kestrel privacy statement

Kestrel is a watch app (with a small part inside the Zepp phone app) and a Home Assistant
integration. It is open source (MIT) and has no servers of its own: **nothing is sent to
the developer or to any third party.** Everything Kestrel sends goes from your watch,
through the Zepp app on your phone, to **your own Home Assistant on your home network**.

## What the watch uses

- **Motion sensors and compass** (accelerometer, gyroscope, compass): to work out where
  your arm points and to recognise gestures. Readings are processed on the watch.
- **Bluetooth scans** of nearby devices that advertise (plugs, bulbs, beacons): to tell
  which room you're in. The watch keeps a summary per room (device addresses and signal
  strengths); phones, watches and other devices that change their address are ignored.
- **Device information** (watch model and its unique id): the model for compatibility,
  the id so Home Assistant can recognise the same watch when it's paired again. Home
  Assistant keeps only a hash of the id.
- **Step count** (only while Detailed diagnostics is turned on in Home Assistant): the
  number of steps taken while Point is open, never your step total, to help tune room
  detection. You can deny the step permission; only this measurement is then missing.

## What is stored, and where

- **On the watch:** your paints (compass directions of each device you painted), room
  calibrations, settings, the device list from Home Assistant, and a short record of the
  screens you opened and any errors.
- **In the Zepp app on your phone:** the watch's key for your Home Assistant (created
  when you pair), Home Assistant's home-network address, a copy of the watch's settings
  for the settings page, and short summaries of measurement results.
- **In your Home Assistant:** each paired watch's name, a hash of its key and of its unique
  id, its paints, rooms and settings, when it was last seen, and the triggers it sent.
  With Detailed diagnostics on (it turns itself off after a week), also aim recordings,
  room scans and the screen record, kept for 14 days. Diagnostics downloads leave out
  keys, unique ids and network addresses, and replace Bluetooth addresses with codes.

## Network

The phone talks only to the Kestrel integration in your Home Assistant, at its address on
your home network (or a VPN into it); Kestrel refuses requests through Home Assistant Cloud
or from public addresses. It never uses Home Assistant's general API. There are no
analytics, no advertising and no tracking. The Zepp app and the watch's firmware handle
their own data under Zepp's privacy policy.

## Removing your data

Unpair the watch (on the watch: More → Unpair, or delete its device in Home Assistant) to
revoke its key; Home Assistant keeps the removed watch's paints, rooms and settings for 30
days in case you pair a watch again, then deletes them. Removing the Kestrel integration
deletes everything it stored. Uninstalling the watch app deletes what the watch stored.

Questions: https://github.com/raetha/zepp-kestrel/issues
