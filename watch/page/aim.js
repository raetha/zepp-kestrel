// Live aim from the sensors: compass heading, forearm pitch and roll, and
// whether the arm is held out and still (the aim gate). Shared by Paint and Point.

import { accel, gyro, compass } from './sensors.js'
import { pitchRoll, mag, AimGate } from '../lib/aim.js'

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
  c.start(null, () => {})

  const timer = setInterval(() => {
    const h = c.read()
    if (!lastA || !h) return
    const { pitch, roll } = pitchRoll(lastA.x, lastA.y, lastA.z)
    const t = Date.now()
    const calibrated = h.calibrated && h.angle !== null
    const ready = aimGate.update(t, gyroDps, pitch, calibrated)
    onAim({ t, heading: h.angle, pitch, roll, calibrated, ready, gyroDps })
  }, 100)

  return {
    stop() {
      clearInterval(timer)
      a.stop()
      g.stop()
      c.stop()
    },
  }
}
