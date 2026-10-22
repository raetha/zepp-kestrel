// Messages between the watch (device app) and the phone (side service).
// Kept in one place so both sides agree on method names.

export const METHOD = {
  PING: 'ww.ping', // phone answers immediately: measures watch <-> phone
  HA_PING: 'ww.haPing', // phone calls HA GET /api/: measures phone <-> HA
  PROBE_LOG: 'ww.probeLog', // watch sends a probe result for storage/forwarding
  FIRE: 'ww.fire', // (M1) run an action on a target
  SYNC: 'ww.sync', // (M1) fetch the target list
}

/**
 * Remembers recently seen sequence numbers so a retried Bluetooth message
 * cannot run a command twice (a double toggle would undo itself).
 */
export class Dedupe {
  constructor(size = 64) {
    this.size = size
    this.seen = []
  }

  /** Returns true the first time a seq is seen, false for repeats. */
  accept(seq) {
    if (this.seen.includes(seq)) return false
    this.seen.push(seq)
    if (this.seen.length > this.size) this.seen.shift()
    return true
  }
}

let counter = 0
/** Sequence numbers unique within one app run. */
export function nextSeq(now = Date.now()) {
  counter = (counter + 1) % 1000
  return now * 1000 + counter
}
