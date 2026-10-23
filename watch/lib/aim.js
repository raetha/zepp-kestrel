// Where the forearm points, from the accelerometer's gravity vector and the
// compass, and the aim gate.
//
// Zepp OS axes: x toward 3 o'clock, y toward 12 o'clock, z out of the screen.
// The forearm runs along x (3-9 o'clock), not y: the M0 tilt probe on a
// Balance 3 showed raising and lowering the arm moving gravity along x. On the
// right wrist the hand is toward 9 o'clock (-x); on the left, toward 3 (+x).
// We take -x as "the hand". On the left wrist that flips the sign of pitch
// and turns the heading by 180 degrees, the same way for painting and
// pointing, so spots still match; the aim gate's limits are symmetric.
//
// The compass reports where 12 o'clock points (clockwise from north), which
// is 90 degrees off the forearm when the screen faces up and drifts further
// as the wrist rolls. attitude() turns it into the forearm's own heading.

import { wrap360 } from '../../lib/circular.js'

const DEG = 180 / Math.PI
const clamp1 = (v) => Math.max(-1, Math.min(1, v))

/**
 * @param ax, ay, az  accelerometer reading (any consistent unit; at rest it
 *                    points up, away from gravity)
 * @param heading12   compass angle of 12 o'clock, 0..360, or null
 * @returns {pitch, roll, heading} in degrees, or null without a reading.
 *   pitch: forearm elevation above horizontal, -90..90
 *   roll: rotation about the forearm, -180..180, 0 = screen facing up
 *   heading: compass heading of the forearm, 0..360, or null. Unreliable
 *     when 12 o'clock points nearly straight up or down (|roll| near 90),
 *     which the aim gate rules out.
 */
export function attitude(ax, ay, az, heading12 = null) {
  const n = Math.sqrt(ax * ax + ay * ay + az * az)
  if (!n) return null
  const ux = ax / n
  const uy = ay / n
  const uz = az / n
  const pitch = Math.asin(clamp1(-ux)) * DEG
  const roll = Math.atan2(uy, uz) * DEG
  let heading = null
  if (typeof heading12 === 'number' && Number.isFinite(heading12)) {
    // Angle from 12 o'clock to 3 o'clock, both projected onto the horizontal
    // plane, counterclockwise seen from above: atan2(u.(y x x), y_h . x_h).
    const theta = Math.atan2(-uz, -ux * uy) * DEG
    heading = wrap360(heading12 - theta + 180)
  }
  return { pitch, roll, heading }
}

/** Magnitude of a 3-vector. */
export function mag(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z)
}

export const AIM_DEFAULTS = {
  maxGyroDps: 30, // arm counts as still below this angular rate
  stillMs: 300, // ...for at least this long
  maxAbsPitch: 70, // not pointing at the ceiling or the floor
  maxAbsRoll: 50, // screen roughly facing up, so the compass heading holds
}

/**
 * Stateful aim gate: feed it gyro samples and the current attitude; it
 * reports whether the arm is held out, still and pointing (true) or not.
 */
export class AimGate {
  constructor(opts = {}) {
    this.o = { ...AIM_DEFAULTS, ...opts }
    this.stillSince = null
  }

  /**
   * @param t          timestamp ms
   * @param gyroDps    gyro magnitude, deg/s
   * @param pitch      degrees
   * @param roll       degrees
   * @param calibrated compass calibration status
   */
  update(t, gyroDps, pitch, roll, calibrated) {
    if (gyroDps > this.o.maxGyroDps) {
      this.stillSince = null
    } else if (this.stillSince === null) {
      this.stillSince = t
    }
    const still = this.stillSince !== null && t - this.stillSince >= this.o.stillMs
    const poseOk = Math.abs(pitch) <= this.o.maxAbsPitch && Math.abs(roll) <= this.o.maxAbsRoll
    return still && poseOk && !!calibrated
  }

  /** Was the arm still for the window ending at t? (used by triggers) */
  stillFor(t, ms) {
    return this.stillSince !== null && t - this.stillSince >= ms
  }

  reset() {
    this.stillSince = null
  }
}
