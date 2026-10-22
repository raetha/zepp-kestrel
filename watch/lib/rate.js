// Measures how often a sensor callback fires and how many readings are new.
// Zepp OS does not publish the Hz of FREQ_MODE_LOW/NORMAL/HIGH, so M0
// measures it on the watch.

import { summarize } from './stats.js'

export class RateMeter {
  constructor() {
    this.reset()
  }

  reset() {
    this.calls = 0
    this.distinct = 0
    this.first = null
    this.last = null
    this.prevKey = null
    this.intervals = []
  }

  /** Call from onChange with a timestamp and the reading. */
  tick(t, reading) {
    this.calls++
    if (this.first === null) this.first = t
    if (this.last !== null) this.intervals.push(t - this.last)
    this.last = t
    const key = reading === undefined ? null : JSON.stringify(reading)
    if (key === null || key !== this.prevKey) this.distinct++
    this.prevKey = key
  }

  /** Report for a run of durationMs. Hz counts calls; distinctHz counts new values. */
  report(durationMs) {
    const s = durationMs / 1000
    return {
      calls: this.calls,
      hz: Math.round((this.calls / s) * 10) / 10,
      distinctHz: Math.round((this.distinct / s) * 10) / 10,
      intervalMs: summarize(this.intervals),
    }
  }
}
