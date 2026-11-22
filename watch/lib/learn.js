// Learning from use, slowly.
//
// Paints: each trigger that locked decisively and wasn't corrected ("Not it?")
// is a small vote for where that device really is from where you stood. The
// votes collect in a few "learned" spots per device, next to the painted ones
// (which are never changed): a vote close to a learned spot moves it a little
// (a running mean that slows down as it gathers votes); a vote elsewhere starts
// a new one. Only decisive locks vote, so a wrong guess can't teach itself, and
// a learned spot that would crowd another device's paint isn't kept.
//
// Rooms: a room check that matched one room clearly nudges that room's
// fingerprint towards what was heard (signal levels drift as furniture, people
// and devices move); devices no longer heard fade out, new steady ones fade in.

import { circularMean, angleDiff, wrap360 } from './circular.js'
import { crowdedBy } from './paint.js'
import { FINGERPRINT_MAX } from './rooms.js'

export const LEARN = {
  minLead: 3, // the lock's lead over the runner-up needed for a trigger to vote
  maxLearned: 3, // learned spots per device (painted spots and corrections are kept apart)
  mergeHeading: 8, // degrees: a vote this close to a learned spot moves it ...
  mergePitch: 6, // ... (else it starts a new one)
  maxVotes: 20, // a spot's mean moves by at least 1/maxVotes of a vote's distance
  spread: 6, // starting heading spread of a learned spot, degrees
  pitchSpread: 4,
}

const r1 = (v) => Math.round(v * 10) / 10

/**
 * The device's spots after one vote at (heading, pitch), or null if nothing changes.
 * @param paints   { id: [spot] } all devices (to avoid crowding the others)
 * @param id       the device that was triggered
 * @param aim      { heading, pitch } where the arm was
 * @param room     room id or null
 */
export function learnSpot(paints, id, aim, room = null, o = LEARN, now = Date.now()) {
  if (!aim || !Number.isFinite(aim.heading) || !Number.isFinite(aim.pitch)) return null
  const spots = (paints && paints[id]) || []
  const learned = spots.filter((s) => s.kind === 'learned' && (s.room || null) === (room || null))
  let near = null
  for (const s of learned) {
    if (Math.abs(angleDiff(aim.heading, s.heading)) <= o.mergeHeading && Math.abs(aim.pitch - s.pitch) <= o.mergePitch) {
      if (!near || Math.abs(angleDiff(aim.heading, s.heading)) < Math.abs(angleDiff(aim.heading, near.heading))) near = s
    }
  }
  let spot
  if (near) {
    const votes = Math.min((near.uses || 1) + 1, o.maxVotes)
    const w = 1 / votes
    const h = circularMean([near.heading, aim.heading], [1 - w, w])
    const dh = Math.abs(angleDiff(aim.heading, near.heading))
    const dp = Math.abs(aim.pitch - near.pitch)
    spot = {
      ...near,
      heading: r1(wrap360(h ? h.mean : near.heading)),
      pitch: r1(near.pitch + w * (aim.pitch - near.pitch)),
      // spreads follow how far the votes land from the mean (never below the classifier's floors)
      headingSpread: r1(Math.max(3, near.headingSpread + w * (dh - near.headingSpread))),
      pitchSpread: r1(Math.max(2, near.pitchSpread + w * (dp - near.pitchSpread))),
      uses: (near.uses || 1) + 1,
      at: now,
    }
  } else {
    spot = { heading: r1(wrap360(aim.heading)), headingSpread: o.spread, pitch: r1(aim.pitch), pitchSpread: o.pitchSpread, n: 1, uses: 1, at: now, kind: 'learned' }
    if (room) spot.room = room
  }
  if (crowdedBy(paints, id, spot)) return null // it would make a neighbour harder to point at
  let next = near ? spots.map((s) => (s === near ? spot : s)) : [...spots, spot]
  // keep the most used learned spots
  const all = next.filter((s) => s.kind === 'learned')
  if (all.length > o.maxLearned) {
    const drop = [...all].sort((a, b) => (a.uses || 1) - (b.uses || 1) || (a.at || 0) - (b.at || 0))[0]
    next = next.filter((s) => s !== drop)
  }
  return next
}

export const ROOM_LEARN = {
  rate: 0.1, // how far one clear check moves the fingerprint
  minScore: 0.5, // the room must match at least this well ...
  margin: 1.5, // ... and beat the next room by this factor
  newRssi: -90, // a newly heard device must be at least this strong to fade in
  dropSeen: 0.2, // a device heard less often than this is dropped
}

/** Whether a ranked room check ([{ id, score }], best first) is clear enough to learn from. */
export function clearMatch(ranked, o = ROOM_LEARN) {
  const [best, second] = ranked || []
  return !!best && best.score >= o.minScore && (!second || best.score >= second.score * o.margin)
}

/** A fingerprint ({ mac: [rssi, seen] }) nudged towards one scan ([{ mac, rssi }]). */
export function adaptFingerprint(fingerprint, scan, o = ROOM_LEARN) {
  const heard = new Map((scan || []).map((d) => [d.mac, d.rssi]))
  const out = {}
  for (const mac of Object.keys(fingerprint || {})) {
    const [rssi, seen] = fingerprint[mac]
    if (heard.has(mac)) {
      out[mac] = [r1(rssi + o.rate * (heard.get(mac) - rssi)), Math.round((seen + o.rate * (1 - seen)) * 100) / 100]
    } else {
      const s = Math.round(seen * (1 - o.rate) * 100) / 100
      if (s >= o.dropSeen) out[mac] = [rssi, s]
    }
  }
  for (const [mac, rssi] of heard) {
    if (!(mac in out) && !(mac in (fingerprint || {})) && rssi >= o.newRssi) out[mac] = [rssi, o.rate]
  }
  // the strongest FINGERPRINT_MAX
  const macs = Object.keys(out).sort((a, b) => out[b][0] - out[a][0]).slice(0, FINGERPRINT_MAX)
  const kept = {}
  for (const mac of macs) kept[mac] = out[mac]
  return kept
}
