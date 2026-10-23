// Wrist-flick trigger. On a Balance 3 a flick peaked at about 1500 deg/s on
// the gyro, against under 300 for snaps, waves, taps and ordinary movement
// (M0 snap recorder), so a gyro threshold separates it well. The motion
// sensors run at 25 Hz, so a flick is one to three samples above threshold.
//
// The flick moves the arm, so the device to act on is the one the aim had in
// mind just before the burst began: Point keeps that (see candidateAt).

/** Peak gyro magnitude (deg/s) in a list of {x, y, z} samples. */
export function peakRate(samples) {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z))
  return peak
}

export const FLICK_DEFAULTS = {
  threshold: 600, // deg/s; replaced by calibration
  lowRatio: 0.3, // a burst starts when the rate passes threshold * lowRatio
  maxBurstMs: 400, // from burst start to the threshold crossing; slower is a swing, not a flick
  refractoryMs: 1200, // ignore the arm settling after a flick
}

export const THRESHOLD_MIN = 250
export const THRESHOLD_MAX = 1500

/**
 * Pick a threshold from calibration: the peaks of several flicks and the
 * highest peak seen during ordinary movement. Returns
 * { ok, threshold, reason } where reason explains a failed calibration.
 */
export function calibrateFlick(flickPeaks, movementPeak) {
  const peaks = flickPeaks.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b)
  if (peaks.length < 3) return { ok: false, threshold: null, reason: 'too few flicks' }
  // the second weakest flick, so one half-hearted flick doesn't drag it down
  const weak = peaks[1]
  const noise = Math.max(movementPeak || 0, 1)
  if (weak < noise * 1.3) return { ok: false, threshold: null, reason: 'flicks too close to ordinary movement' }
  // geometric midpoint between ordinary movement and a weak flick
  const t = Math.sqrt(weak * noise)
  const threshold = Math.round(Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, t)))
  return { ok: true, threshold, reason: null }
}

/** Feed gyro magnitudes in time order; update() returns true once per flick. */
export class FlickDetector {
  constructor(opts = {}) {
    this.o = { ...FLICK_DEFAULTS, ...opts }
    this.burstStart = null
    this.lastFlick = -Infinity
    this.fired = false
  }

  /**
   * @param t   ms timestamp
   * @param dps gyro magnitude, deg/s
   * @returns true when this sample completes a flick
   */
  update(t, dps) {
    const low = this.o.threshold * this.o.lowRatio
    if (dps < low) {
      this.burstStart = null
      this.fired = false
      return false
    }
    if (this.burstStart === null) this.burstStart = t
    if (this.fired || t - this.lastFlick < this.o.refractoryMs) return false
    if (dps >= this.o.threshold && t - this.burstStart <= this.o.maxBurstMs) {
      this.fired = true
      this.lastFlick = t
      return true
    }
    return false
  }

  /** When the current (or last) burst began: the moment to look up the aim at. */
  get startedAt() {
    return this.burstStart
  }
}

/**
 * The device the aim had in mind at time t: the newest remembered candidate
 * no older than maxAgeMs before t. `history` holds { t, id } entries.
 */
export function candidateAt(history, t, maxAgeMs = 800) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (h.t > t) continue
    return t - h.t <= maxAgeMs ? h.id : null
  }
  return null
}
