// Live aim from the sensors: the forearm's compass heading, pitch and roll,
// and whether the arm is held out and still (the aim gate). Shared by Paint and Point.

import { accel, gyro, compass } from './sensors.js'
import { attitude, mag, tiltBetween, AimGate } from '../lib/aim.js'
import { safe } from './trail.js'

/**
 * @param onAim  called every 100 ms with the current aim
 * @param opts.onGyro  called with (t, deg/s) for every gyro reading (25 Hz)
 * @param opts.onAccel called with (t, {x, y, z}) for every accelerometer reading
 *                     (both for gesture triggers, lib/gesture.js)
 */
export function startAim(onAim, { mode = 'NORMAL', gate = {}, onGyro = null, onAccel = null } = {}) {
  const a = accel()
  const g = gyro()
  const c = compass()
  const aimGate = new AimGate(gate)
  let lastA = null
  let gyroDps = 0
  let gyroAt = 0
  let tiltDps = 0 // how fast gravity's direction turns: stands in for the gyro on watches without one

  const accelCb = onAccel ? safe('accel', onAccel) : null
  a.start(mode, (s) => {
    // at least 20 ms apart: readings delivered in a burst would make the rate look huge
    if (lastA && s.t > lastA.t) tiltDps = 0.7 * tiltDps + 0.3 * (tiltBetween(lastA, s) / (Math.max(20, s.t - lastA.t) / 1000))
    lastA = s
    if (accelCb) accelCb(s.t, s)
  })
  const gyroCb = onGyro ? safe('gyro', onGyro) : null
  let hasGyro = true
  try {
    g.start(mode, (s) => {
      gyroDps = mag(s.x, s.y, s.z)
      gyroAt = Date.now()
      if (gyroCb) gyroCb(s.t, gyroDps)
    })
  } catch (e) {
    hasGyro = false // some watches have none: stillness then comes from the accelerometer, and flicks can't be told
  }
  let hasCompass = true
  try {
    c.start('NORMAL', () => {})
  } catch (e) {
    hasCompass = false
  }

  const timer = setInterval(safe('aim', () => {
    const h = hasCompass ? c.read() : { calibrated: false, angle: null }
    if (!lastA || !h) return
    const calibrated = h.calibrated && h.angle !== null
    const att = attitude(lastA.x, lastA.y, lastA.z, calibrated ? h.angle : null)
    if (!att) return
    const { pitch, roll, heading } = att
    const t = Date.now()
    const turning = t - gyroAt < 1000 ? gyroDps : tiltDps
    const ready = aimGate.update(t, turning, pitch, roll, calibrated && heading !== null)
    onAim({ t, heading, pitch, roll, calibrated, ready, gyroDps: turning, noCompass: !hasCompass, noGyro: !hasGyro })
  }), 100)

  return {
    stop() {
      clearInterval(timer)
      a.stop()
      if (hasGyro) g.stop()
      if (hasCompass) c.stop()
    },
  }
}
