// Progress while the compass calibrates. Zepp OS gives apps no raw magnetic
// field and no calibration progress, only "calibrated yet or not", so this
// tracks the motion it asks for instead: the watch turned in a circle, i.e.
// its tilt swept through every direction. Each tick lights when the watch
// has leaned that way. It shows that you're doing the motion, not how far
// the watch's own calibration has got; that one only says when it's done.

import { wrap360 } from './circular.js'

const DEG = 180 / Math.PI

export class Circling {
  constructor({ ticks = 12, minTilt = 15 } = {}) {
    this.ticks = ticks
    this.minTilt = minTilt
    this.lit = new Array(ticks).fill(false)
  }

  /** Feed the watch's pitch and roll (degrees). Returns the tick that just lit, or -1. */
  add(pitch, roll) {
    if (!Number.isFinite(pitch) || !Number.isFinite(roll)) return -1
    if (Math.hypot(pitch, roll) < this.minTilt) return -1
    const i = Math.floor(wrap360(Math.atan2(roll, pitch) * DEG) / (360 / this.ticks)) % this.ticks
    if (this.lit[i]) return -1
    this.lit[i] = true
    return i
  }

  get count() {
    return this.lit.filter(Boolean).length
  }

  /** Lit share, 0..1; a full circle starts over so the ring keeps showing movement. */
  get fraction() {
    return this.count / this.ticks
  }

  reset() {
    this.lit.fill(false)
  }
}
