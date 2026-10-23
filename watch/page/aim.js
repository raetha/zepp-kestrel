// Live aim from the sensors: the forearm's compass heading, pitch and roll,
// and whether the arm is held out and still (the aim gate). Shared by Paint and Point.

import { accel, gyro, compass } from './sensors.js'
import { attitude, mag, AimGate } from '../lib/aim.js'
import { safe } from './trail.js'

export function startAim(onAim, { mode = 'NORMAL', gate = {} } = {}) {
  const a = accel()
  const g = gyro()
  const c = compass()
  const aimGate = new AimGate(gate)
  let lastA = null
  let gyroDps = 0

  a.start(mode, (s) => {
    lastA = s
  })
  g.start(mode, (s) => {
    gyroDps = mag(s.x, s.y, s.z)
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
