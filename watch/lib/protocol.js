// Messages between the watch (device app) and the phone (side service).
// Kept in one place so both sides agree on method names.

export const METHOD = {
  PING: 'kestrel.ping', // phone answers immediately: measures watch <-> phone
  HA_PING: 'kestrel.haPing', // phone calls HA GET /api/: measures phone <-> HA
  PROBE_LOG: 'kestrel.probeLog', // watch sends a probe result for storage/forwarding
  STATUS: 'kestrel.status', // { paired, mode, haName }
  DISCOVER: 'kestrel.discover', // { address? } look for Home Assistant on the local network (or at a typed address)
  PAIR_START: 'kestrel.pairStart', // { url, watchName } -> { pairingId } (HA shows a code)
  PAIR_CONFIRM: 'kestrel.pairConfirm', // { url, pairingId, code } -> { ok, haName, error }
  UNPAIR: 'kestrel.unpair',
  SYNC: 'kestrel.sync', // { only?, have? } -> { watch_id, targets?, areas?, targets_hash, settings?, paints?, rooms?, *_rev, room } (see ha-client sync)
  FIRE: 'kestrel.fire', // { seq, target, action, value, confirmed } -> { ok, state, needsConfirm, error }
  SAVE: 'kestrel.save', // { section: 'paints' | 'rooms', changes: { key: value | null }, base: rev } -> { ok, rev, stale }
  SAVE_SETTINGS: 'kestrel.saveSettings', // { settings: { group: {...} } } -> { ok, rev, settings } after a change on the watch
  ROOM: 'kestrel.room', // -> { room: { id, name } | null } from a Home Assistant sensor, if configured
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
