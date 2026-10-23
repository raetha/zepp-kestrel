// Painting: turn the aim samples recorded while sweeping across a device into a
// "spot" (where the device is, seen from where the user stood), and keep a
// device's spots in a bounded list.

import { circularMean } from '../../lib/circular.js'
import { mean, stdev } from '../../lib/stats.js'

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

/** Add a spot to a device's list, keeping the newest MAX_SPOTS. Returns a new array. */
export function addSpot(spots, spot) {
  return [...(spots || []), spot].slice(-MAX_SPOTS)
}

/** Why a spot shouldn't be saved, or null if it's fine. */
export function spotProblem(spot) {
  if (!spot) return 'few'
  if (spot.headingSpread > MAX_HEADING_SPREAD) return 'unsteady'
  return null
}
