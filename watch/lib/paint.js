// Painting: turn the aim samples recorded while sweeping across a device into a
// "spot" (where the device is, seen from where the user stood), and keep a
// device's spots in a bounded list.

import { circularMean, angleDiff } from './circular.js'
import { mean, stdev } from './stats.js'
import { fitSpot, DEFAULTS as AIM } from './classifier.js'

export const MAX_SPOTS = 6 // per device; oldest dropped first
export const MIN_SAMPLES = 20 // a paint with fewer usable samples is rejected
export const MAX_HEADING_SPREAD = 35 // degrees: wider means the compass was unsteady (or the sweep too wide)

/**
 * @param samples [{ heading, pitch }] in degrees (heading 0..360, pitch -90..90)
 * @returns spot { heading, headingSpread, pitch, pitchSpread, n, at } or null if too few samples
 */
export function makeSpot(samples, at = Date.now()) {
  const usable = samples.filter((s) => Number.isFinite(s.heading) && Number.isFinite(s.pitch))
  if (usable.length < MIN_SAMPLES) return null
  const h = circularMean(usable.map((s) => s.heading))
  if (!h) return null
  const pitches = usable.map((s) => s.pitch)
  const r = (v) => Math.round(v * 10) / 10
  return {
    heading: r(h.mean),
    headingSpread: r(h.spread),
    pitch: r(mean(pitches)),
    pitchSpread: r(stdev(pitches)),
    n: usable.length,
    at,
  }
}

/** Add a painted spot, keeping the newest MAX_SPOTS painted ones (and any corrections). Returns a new array. */
export function addSpot(spots, spot) {
  const painted = [...(spots || []).filter((s) => s.kind !== 'correction'), spot].slice(-MAX_SPOTS)
  return [...painted, ...(spots || []).filter((s) => s.kind === 'correction')]
}

/** Why a spot shouldn't be saved, or null if it's fine. */
export function spotProblem(spot) {
  if (!spot) return 'few'
  if (spot.headingSpread > MAX_HEADING_SPREAD) return 'unsteady'
  return null
}

// Corrections: when the watch picked the wrong device and the user chose
// the runner-up instead, a small spot where they actually aimed teaches the
// right device. Each device keeps at most MAX_CORRECTIONS of these, apart
// from its painted spots, so corrections never push painted spots out.
export const MAX_CORRECTIONS = 2
const CORRECTION_HEADING_SPREAD = 4
const CORRECTION_PITCH_SPREAD = 3

export function correctionSpot(heading, pitch, at = Date.now()) {
  if (!Number.isFinite(heading) || !Number.isFinite(pitch)) return null
  const r = (v) => Math.round(v * 10) / 10
  return {
    heading: r(heading),
    headingSpread: CORRECTION_HEADING_SPREAD,
    pitch: r(pitch),
    pitchSpread: CORRECTION_PITCH_SPREAD,
    n: 1,
    at,
    kind: 'correction',
  }
}

/** Add a correction spot, keeping painted spots and the newest MAX_CORRECTIONS corrections. */
export function addCorrection(spots, spot) {
  if (!spot) return spots || []
  const painted = (spots || []).filter((s) => s.kind !== 'correction')
  const corrections = [...(spots || []).filter((s) => s.kind === 'correction'), spot].slice(-MAX_CORRECTIONS)
  return [...painted, ...corrections]
}

// Crowding: a new spot right next to another device's is hard to tell apart when
// pointing (the lock needs a 2x lead). After painting, the watch says so, so you
// can paint from where the two stand further apart, or aim more carefully.
/**
 * The other device that crowds `spot` most, or null if it stands clear.
 * paints = { id: [spot] }; returns { id, headingGap, pitchGap } (degrees).
 */
export function crowdedBy(paints, id, spot, o = AIM) {
  if (!spot) return null
  const own = fitSpot(spot, spot.heading, spot.pitch, o).weight
  let worst = null
  for (const other of Object.keys(paints || {})) {
    if (other === id) continue
    for (const s of paints[other] || []) {
      if (s.kind === 'correction') continue
      // rooms are left out: in open-plan spaces the watch can't always tell which one it's in
      const w = fitSpot(s, spot.heading, spot.pitch, o).weight
      // aimed at the middle of the new spot, the other device must stay well behind
      if (w * o.lockMargin * 1.5 > own && (!worst || w > worst.w)) {
        worst = { id: other, w, headingGap: Math.round(Math.abs(angleDiff(s.heading, spot.heading))), pitchGap: Math.round(Math.abs(s.pitch - spot.pitch)) }
      }
    }
  }
  return worst && { id: worst.id, headingGap: worst.headingGap, pitchGap: worst.pitchGap }
}
