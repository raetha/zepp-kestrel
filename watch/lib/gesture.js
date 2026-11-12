// Gesture trigger: a wrist flick, a finger snap or a finger tap.
//
// The motion sensors run at 25 Hz (M0), so a gesture is one to three samples.
// Two channels are watched:
//   gyro  how fast the wrist turns (deg/s). A flick peaked near 1500 on a
//         Balance 3; snaps 50-270.
//   jolt  how far the accelerometer jumps between two readings (its units,
//         about 1000 per g). Snaps and taps shake the wrist more than they turn it.
// Calibration records the chosen gesture and ordinary aiming movement, and
// sets a threshold on each channel that separates them (null = channel not
// used). Gestures only count while aiming, when the arm is otherwise still,
// so the comparison is against small aiming adjustments, not waving about.
//
// The gesture moves the arm, so the device to act on is the one the aim had
// in mind when the burst began (candidateAt).

/** Peak gyro magnitude (deg/s) in a list of {x, y, z} samples. */
export function peakRate(samples) {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z))
  return peak
}

/** Peak jolt: the largest change between consecutive {x, y, z} accelerometer samples. */
export function peakJolt(samples) {
  let peak = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i]
    const b = samples[i - 1]
    peak = Math.max(peak, Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2))
  }
  return peak
}

export const LIMITS = {
  gyro: { min: 60, max: 1500 },
  jolt: { min: 40, max: 3000 },
}
export const SEPARATION = 1.5 // a gesture must be this many times ordinary movement on a channel

/**
 * Thresholds from calibration.
 * @param gestures [{ gyro, jolt }] peaks of each recorded gesture
 * @param movement { gyro, jolt } peaks during ordinary aiming movement
 * @returns { ok, gyro, jolt, reason } (a channel that doesn't separate is null)
 */
export function calibrateGesture(gestures, movement) {
  const out = { ok: false, gyro: null, jolt: null, reason: null }
  if (gestures.length < 3) return { ...out, reason: 'too few gestures' }
  for (const ch of ['gyro', 'jolt']) {
    const peaks = gestures.map((g) => g[ch]).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b)
    if (peaks.length < 3) continue
    const weak = peaks[1] // the second weakest, so one half-hearted gesture doesn't decide
    const noise = Math.max((movement && movement[ch]) || 0, 1)
    if (weak < noise * SEPARATION) continue
    const t = Math.sqrt(weak * noise) // geometric midpoint
    out[ch] = Math.round(Math.min(LIMITS[ch].max, Math.max(LIMITS[ch].min, t)))
  }
  out.ok = out.gyro !== null || out.jolt !== null
  if (!out.ok) out.reason = 'the gesture is too close to ordinary movement'
  return out
}

/** One channel: fires when a burst crosses the threshold soon enough after it began. */
class Burst {
  constructor(threshold, lowRatio, maxBurstMs) {
    this.threshold = threshold
    this.low = threshold * lowRatio
    this.maxBurstMs = maxBurstMs
    this.start = null
  }

  update(t, v) {
    if (v < this.low) {
      this.start = null
      return false
    }
    if (this.start === null) this.start = t
    return v >= this.threshold && t - this.start <= this.maxBurstMs
  }
}

export const DETECTOR_DEFAULTS = {
  lowRatio: 0.3, // a burst starts above threshold * lowRatio
  maxBurstMs: 400, // slower than this to cross the threshold is a swing, not a gesture
  refractoryMs: 1200, // ignore the arm settling after a gesture
}

/** Until calibrated, a wrist flick uses this; snaps and taps need calibrating first. */
export const FLICK_DEFAULT = { gyro: 600, jolt: null }

/**
 * The thresholds for the chosen gesture: settings.gesture is
 * { enabled, kind, calibrations: { flick: {gyro, jolt}, snap: {...}, tap: {...} } }.
 * Each gesture keeps its own calibration, so switching (on the watch or in
 * Home Assistant) doesn't lose the others. Returns null when the gesture
 * trigger is off or the chosen gesture isn't calibrated (and has no default).
 */
export function gestureThresholds(g) {
  if (!g || !g.enabled) return null
  const cal = (g.calibrations || {})[g.kind]
  if (cal && (cal.gyro || cal.jolt)) return { gyro: cal.gyro || null, jolt: cal.jolt || null }
  return g.kind === 'flick' ? { ...FLICK_DEFAULT } : null
}

/** Feed gyro and accelerometer readings in time order; each returns true once per gesture. */
export class GestureDetector {
  constructor({ gyro = 600, jolt = null, ...opts } = {}) {
    this.o = { ...DETECTOR_DEFAULTS, ...opts }
    this.gyro = gyro ? new Burst(gyro, this.o.lowRatio, this.o.maxBurstMs) : null
    this.jolt = jolt ? new Burst(jolt, this.o.lowRatio, this.o.maxBurstMs) : null
    this.prevA = null
    this.last = -Infinity
    this.mutedUntil = -Infinity
    this.startedAt = null
  }

  /**
   * Ignore everything until time t: after a trigger (so one gesture can't
   * toggle a device twice) and while the watch itself vibrates (a buzz jolts
   * the accelerometer like a snap or tap does).
   */
  quiet(t) {
    this.mutedUntil = Math.max(this.mutedUntil, t)
  }

  _fire(t, burst) {
    if (t < this.mutedUntil) return false
    if (t - this.last < this.o.refractoryMs) return false
    this.last = t
    this.startedAt = burst.start
    return true
  }

  /** @param dps gyro magnitude, deg/s */
  gyroUpdate(t, dps) {
    return !!this.gyro && this.gyro.update(t, dps) && this._fire(t, this.gyro)
  }

  /** @param a accelerometer reading {x, y, z} */
  accelUpdate(t, a) {
    const prev = this.prevA
    this.prevA = a
    if (!this.jolt || !prev) return false
    const v = Math.sqrt((a.x - prev.x) ** 2 + (a.y - prev.y) ** 2 + (a.z - prev.z) ** 2)
    return this.jolt.update(t, v) && this._fire(t, this.jolt)
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
