// Analyses a short window of accelerometer samples for a sharp spike, the
// signature a finger snap or a tap should leave. Used by the M0 snap
// recorder now, and the basis of the real snap detector later.

import { mag } from './aim.js'
import { median } from '../../lib/stats.js'

/**
 * @param samples array of { t, x, y, z } in ms and cm/s^2, time-ordered
 * @returns {
 *   n, hz,              sample count and effective rate over the window
 *   peakJerk, peakT,    largest |d|a|/dt| (cm/s^3) and when it happened
 *   peakDev,            largest |a| deviation from the window median (cm/s^2)
 *   widthMs,            how long |a| stayed above half the peak deviation
 * }
 */
export function analyzeSpike(samples) {
  const n = samples.length
  if (n < 3) return { n, hz: 0, peakJerk: 0, peakT: null, peakDev: 0, widthMs: 0 }

  const mags = samples.map((s) => mag(s.x, s.y, s.z))
  const base = median(mags)
  const span = samples[n - 1].t - samples[0].t
  const hz = span > 0 ? Math.round(((n - 1) / span) * 1000 * 10) / 10 : 0

  let peakJerk = 0
  let peakT = null
  for (let i = 1; i < n; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000
    if (dt <= 0) continue
    const j = Math.abs(mags[i] - mags[i - 1]) / dt
    if (j > peakJerk) {
      peakJerk = j
      peakT = samples[i].t
    }
  }

  let peakDev = 0
  let peakIdx = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(mags[i] - base)
    if (d > peakDev) {
      peakDev = d
      peakIdx = i
    }
  }

  // Width at half the peak deviation around the peak.
  const half = peakDev / 2
  let lo = peakIdx
  let hi = peakIdx
  while (lo > 0 && Math.abs(mags[lo - 1] - base) >= half) lo--
  while (hi < n - 1 && Math.abs(mags[hi + 1] - base) >= half) hi++
  const widthMs = samples[hi].t - samples[lo].t

  return {
    n,
    hz,
    peakJerk: Math.round(peakJerk),
    peakT,
    peakDev: Math.round(peakDev),
    widthMs,
  }
}
