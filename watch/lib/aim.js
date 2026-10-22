// Arm orientation from the accelerometer's gravity vector, and the aim gate.
//
// Zepp OS axes: x and y lie in the screen plane, z points out of the screen.
// With the watch worn normally, +y points from 6 o'clock to 12 o'clock, i.e.
// along the forearm toward the hand. The signs below are the working
// assumption; the M0 tilt probe confirms them on the real watch.

const DEG = 180 / Math.PI

/**
 * Pitch: elevation of the forearm (12 o'clock direction) above horizontal,
 * in degrees, -90..90. Roll: rotation about the forearm, -180..180,
 * 0 = screen facing up.
 * Input is acceleration in any consistent unit (Zepp reports cm/s^2).
 */
export function pitchRoll(ax, ay, az) {
  // At rest the accelerometer reads the reaction to gravity (+1g "up").
  // If the hand is raised, +y points up, so ay is positive.
  const pitch = Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * DEG
  const roll = Math.atan2(-ax, az) * DEG
  return { pitch, roll }
}

/** Magnitude of a 3-vector. */
export function mag(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z)
}

export const AIM_DEFAULTS = {
  maxGyroDps: 30, // arm counts as still below this angular rate
  stillMs: 300, // ...for at least this long
  minPitch: -30,
  maxPitch: 70,
}

/**
 * Stateful aim gate: feed it gyro samples and the current pitch; it reports
 * whether the arm is held out, still and pointing (true) or not.
 */
export class AimGate {
  constructor(opts = {}) {
    this.o = { ...AIM_DEFAULTS, ...opts }
    this.stillSince = null
  }

  /**
   * @param t        timestamp ms
   * @param gyroDps  gyro magnitude, deg/s
   * @param pitch    degrees
   * @param calibrated compass calibration status
   */
  update(t, gyroDps, pitch, calibrated) {
    if (gyroDps > this.o.maxGyroDps) {
      this.stillSince = null
    } else if (this.stillSince === null) {
      this.stillSince = t
    }
    const still = this.stillSince !== null && t - this.stillSince >= this.o.stillMs
    const pitchOk = pitch >= this.o.minPitch && pitch <= this.o.maxPitch
    return still && pitchOk && !!calibrated
  }

  /** Was the arm still for the window ending at t? (used by triggers) */
  stillFor(t, ms) {
    return this.stillSince !== null && t - this.stillSince >= ms
  }

  reset() {
    this.stillSince = null
  }
}
