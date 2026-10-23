// Messages between the watch (device app) and the phone (side service).
// Kept in one place so both sides agree on method names.

export const METHOD = {
  PING: 'ww.ping', // phone answers immediately: measures watch <-> phone
  HA_PING: 'ww.haPing', // phone calls HA GET /api/: measures phone <-> HA
  PROBE_LOG: 'ww.probeLog', // watch sends a probe result for storage/forwarding
  STATUS: 'ww.status', // { paired, mode, haName }
  DISCOVER: 'ww.discover', // { address? } look for Home Assistant on the local network (or at a typed address)
  PAIR_START: 'ww.pairStart', // { url, watchName } -> { pairingId } (HA shows a code)
  PAIR_CONFIRM: 'ww.pairConfirm', // { url, pairingId, code } -> { ok, haName, error }
  UNPAIR: 'ww.unpair',
  SYNC: 'ww.sync', // -> { targets: [{ id, name, domain, area, dimmable, confirm }] }
  FIRE: 'ww.fire', // { seq, target, action, value, confirmed } -> { ok, state, needsConfirm, error }
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
