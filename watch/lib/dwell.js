// Instant toggle: trigger a device just by holding the aim on it.
//
// Pointing is locked on one device continuously for `ms` -> fire once. Brief
// flickers out of the lock (under `graceMs`) don't restart the count. After
// firing, the same device can't fire again until the aim has left it for
// `rearmMs`: holding still on a lamp toggles it once, not every few seconds.

export const DWELL_DEFAULTS = {
  ms: 3000,
  graceMs: 300, // a lock that drops out this briefly still counts as continuous
  rearmMs: 1000, // after a dwell trigger, look away this long before that device can fire again
}

export class Dwell {
  constructor(opts = {}) {
    this.o = { ...DWELL_DEFAULTS, ...opts }
    this.id = null // device being dwelled on
    this.since = null // when the dwell on it began
    this.lastLocked = null // last time it was seen locked
    this.spent = null // device that fired and isn't re-armed yet
    this.awayFrom = null // since when the aim has been off the spent device
  }

  /**
   * @param t      ms timestamp
   * @param locked id of the device the aim is locked on, or null
   * @returns { fire: id | null, progress: 0..1, id }  progress for showing a countdown
   */
  update(t, locked) {
    // re-arm the device that last fired once the aim has left it for a while
    if (this.spent !== null) {
      if (locked === this.spent) this.awayFrom = null
      else if (this.awayFrom === null) this.awayFrom = t
      else if (t - this.awayFrom >= this.o.rearmMs) {
        this.spent = null
        this.awayFrom = null
      }
    }

    if (locked !== null && locked === this.spent) return { fire: null, progress: 0, id: null }

    if (locked === null) {
      if (this.id !== null && this.lastLocked !== null && t - this.lastLocked <= this.o.graceMs) {
        return { fire: null, progress: this.progress(t), id: this.id }
      }
      this.reset()
      return { fire: null, progress: 0, id: null }
    }

    if (locked !== this.id) {
      this.id = locked
      this.since = t
    }
    this.lastLocked = t
    if (t - this.since >= this.o.ms) {
      const id = this.id
      this.spent = id
      this.awayFrom = null
      this.reset()
      return { fire: id, progress: 1, id }
    }
    return { fire: null, progress: this.progress(t), id: this.id }
  }

  progress(t) {
    return this.since === null ? 0 : Math.min(1, (t - this.since) / this.o.ms)
  }

  reset() {
    this.id = null
    this.since = null
    this.lastLocked = null
  }

  /** Something else triggered (button, gesture): count from scratch, and don't fire that device again until re-armed. */
  triggered(id) {
    this.reset()
    this.spent = id
    this.awayFrom = null
  }
}
