// Which room is the watch in? Bluetooth fingerprints.
//
// Calibrating a room records a few scans while walking around it. A
// fingerprint keeps, for each steady device heard, its average signal and how
// often it was heard. A later scan is scored against each room: devices the
// room expects count by how often they're heard there and how close their
// signal is; strong devices the room doesn't know count against it.
// Rotating (random) addresses are dropped before this (lib/ble.js).
//
// Rooms are Home Assistant areas, keyed by area id.

export const FINGERPRINT_MAX = 60 // strongest devices kept per room
export const MIN_SEEN = 0.5 // with several scans, keep devices heard in at least half of them
export const STRONG_RSSI = -75 // an unknown device this strong suggests another room
export const RSSI_SIGMA = 10 // dB: how far a signal may wander and still count

/**
 * @param scans [[{ mac, rssi }]] one list per scan
 * @returns { mac: [meanRssi, seenFraction] }
 */
export function buildFingerprint(scans) {
  const n = scans.length
  if (!n) return {}
  const seen = new Map()
  for (const scan of scans) {
    for (const d of scan) {
      const e = seen.get(d.mac) || { sum: 0, count: 0 }
      e.sum += d.rssi
      e.count++
      seen.set(d.mac, e)
    }
  }
  const rows = []
  for (const [mac, e] of seen) {
    const frac = Math.min(1, e.count / n)
    if (n > 1 && frac < MIN_SEEN) continue
    rows.push([mac, Math.round(e.sum / e.count), Math.round(frac * 100) / 100])
  }
  rows.sort((a, b) => b[1] - a[1])
  const fp = {}
  for (const [mac, rssi, frac] of rows.slice(0, FINGERPRINT_MAX)) fp[mac] = [rssi, frac]
  return fp
}

/** How well one scan matches one fingerprint, 0..1. */
export function scoreRoom(fingerprint, scan) {
  const byMac = new Map(scan.map((d) => [d.mac, d.rssi]))
  let total = 0
  let got = 0
  for (const mac of Object.keys(fingerprint)) {
    const [rssi, seen] = fingerprint[mac]
    total += seen
    if (byMac.has(mac)) {
      const d = (byMac.get(mac) - rssi) / RSSI_SIGMA
      got += seen * Math.exp(-0.5 * d * d)
    }
  }
  if (!total) return 0
  let strangers = 0
  for (const d of scan) if (!(d.mac in fingerprint) && d.rssi >= STRONG_RSSI) strangers++
  return (got / total) / (1 + 0.15 * strangers)
}

/** Rooms ranked best first: [{ id, name, score }]. rooms = { id: { name, fingerprint } } */
export function rankRooms(rooms, scan) {
  const out = Object.keys(rooms || {}).map((id) => ({ id, name: rooms[id].name, score: scoreRoom(rooms[id].fingerprint || {}, scan) }))
  out.sort((a, b) => b.score - a.score)
  return out
}

// minScore: a room calibrated where you stand scores 0.66-0.99 on a real home's
// scans; an uncalibrated room scored up to 0.52 against the room that sounded
// most like it, and was taken for it.
export const PICK = { minScore: 0.6, margin: 1.25 }

/** The room to believe, or null when no room matches clearly. */
export function pickRoom(ranked, o = PICK) {
  const [best, second] = ranked
  if (!best || best.score < o.minScore) return null
  if (second && best.score < second.score * o.margin) return null
  return { id: best.id, name: best.name, score: Math.round(best.score * 100) / 100 }
}

// How much a spot painted in another room still counts:
//  - the room matched clearly (or comes from a Home Assistant sensor): not at all.
//    A device painted only in another room is never picked here. To use one from
//    here (a light seen through a doorway), paint it from here too.
//  - the room matched, but only just (rooms sharing an open-plan space sound alike
//    to Bluetooth): half, enough to settle a tie (a lock needs a 2x lead) without
//    hiding a device the watch may have placed in the wrong room.
//  - no room: everything counts.
export const OTHER_ROOM_PRIOR = 0.5

/**
 * The spots as they apply in a room: those painted there, and those painted
 * before rooms were known (no room), count fully; spots from other rooms count
 * `otherPrior` (0 leaves them out). Without a room, all count fully.
 */
export function spotsForRoom(spots, roomId, otherPrior = OTHER_ROOM_PRIOR) {
  if (!roomId) return spots
  const out = []
  for (const s of spots) {
    if (!s.room || s.room === roomId) out.push(s)
    else if (otherPrior > 0) out.push({ ...s, prior: otherPrior })
  }
  return out
}

/** A fingerprint read as if it were one scan. */
function asScan(fingerprint) {
  return Object.keys(fingerprint || {}).map((mac) => ({ mac, rssi: fingerprint[mac][0] }))
}

export const ALIKE_SCORE = 0.5 // rooms whose fingerprints match each other this well can't be told apart reliably

/**
 * The calibrated room that sounds most like `id` to Bluetooth, or null.
 * Rooms that share a space (open-plan kitchen and dining room) often do; the
 * watch then mostly can't say which of them it's in, and relies on aim alone.
 * -> { id, name, score }
 */
export function soundsLike(rooms, id) {
  const me = rooms && rooms[id]
  if (!me || !me.fingerprint) return null
  let best = null
  for (const other of Object.keys(rooms)) {
    if (other === id || !rooms[other].fingerprint) continue
    // both ways: a small room inside a big one's range matches one way only
    const score = Math.min(scoreRoom(rooms[other].fingerprint, asScan(me.fingerprint)), scoreRoom(me.fingerprint, asScan(rooms[other].fingerprint)))
    if (score >= ALIKE_SCORE && (!best || score > best.score)) best = { id: other, name: rooms[other].name, score: Math.round(score * 100) / 100 }
  }
  return best
}
