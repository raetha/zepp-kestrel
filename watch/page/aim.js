// Live aim from the sensors: the forearm's compass heading, pitch and roll,
// and whether the arm is held out and still (the aim gate). Shared by Paint and Point.

import { accel, gyro, compass } from './sensors.js'
import { attitude, mag, AimGate } from '../lib/aim.js'
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

  const accelCb = onAccel ? safe('accel', onAccel) : null
  a.start(mode, (s) => {
    lastA = s
    if (accelCb) accelCb(s.t, s)
  })
  const gyroCb = onGyro ? safe('gyro', onGyro) : null
  g.start(mode, (s) => {
    gyroDps = mag(s.x, s.y, s.z)
    if (gyroCb) gyroCb(s.t, gyroDps)
  })
  c.start('NORMAL', () => {})

  const timer = setInterval(safe('aim', () => {
    const h = c.read()
    if (!lastA || !h) return
    const calibrated = h.calibrated && h.angle !== null
    const att = attitude(lastA.x, lastA.y, lastA.z, calibrated ? h.angle : null)
    if (!att) return
    const { pitch, roll, heading } = att
    const t = Date.now()
    const ready = aimGate.update(t, gyroDps, pitch, roll, calibrated && heading !== null)
    onAim({ t, heading, pitch, roll, calibrated, ready, gyroDps })
  }), 100)

  return {
    stop() {
      clearInterval(timer)
      a.stop()
      g.stop()
      c.stop()
    },
  }
}
