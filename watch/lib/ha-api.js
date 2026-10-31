// Kestrel's Home Assistant requests, built on the watch. The phone side only relays
// them (METHOD.RELAY: it adds the watch's token and tries Home Assistant's known
// addresses), so a new feature needs no new phone side. The Zepp app doesn't always
// replace the phone side when a new build is installed (docs/development.md).
//
//   call(path, { method, body }) -> Promise<body>   (throws Error on failure)
//
// Each method returns what the phone side's own handler used to return, so pages
// don't care which way a request went.

/** The paths the phone side will relay: Kestrel's endpoints only. */
export const RELAY_PREFIX = '/api/kestrel/'

export function relayable(path, method) {
  return (
    typeof path === 'string' &&
    path.startsWith(RELAY_PREFIX) &&
    !path.includes('..') &&
    !/[\s#\\]/.test(path) &&
    !/%2e|%2f|%5c/i.test(path) && // no encoded dots or slashes either
    path.length <= 2000 &&
    (method === 'GET' || method === 'POST')
  )
}

export class HaApi {
  constructor(call) {
    this.call = call
  }

  /**
   * Everything the watch keeps in sync. only: some sections (['paints']); have
   * ({ targets: hash, paints: rev, ... }): what the watch already has; version: the
   * watch's build; deviceId: the watch's unique id (Home Assistant keeps a hash).
   * -> { watch_id, targets?, areas?, targets_hash, settings?, paints?, rooms?, *_rev, room }
   */
  async sync({ only = null, have = null, version = null, deviceId = null } = {}) {
    const q = []
    if (only) q.push(`only=${only.join(',')}`)
    if (have) q.push(`have=${Object.keys(have).map((k) => `${k}:${have[k]}`).join(',')}`)
    if (version) q.push(`v=${encodeURIComponent(version)}`)
    if (deviceId) q.push(`d=${encodeURIComponent(deviceId)}`)
    return (await this.call(`/api/kestrel/sync${q.length ? `?${q.join('&')}` : ''}`)) || {}
  }

  /** Only what changed in one section (paints, rooms). -> { ok, rev, stale } */
  async save({ section, changes = {}, base } = {}) {
    if (section !== 'paints' && section !== 'rooms') throw Object.assign(new Error('unknown section'), { replied: true })
    const b = await this.call(`/api/kestrel/${section}`, { method: 'POST', body: { changes, base } })
    return { ok: true, rev: b && b.rev, stale: !!(b && b.stale) }
  }

  /** Changed settings ({ group: {...} }). -> { ok, rev, settings } */
  async saveSettings({ settings = {} } = {}) {
    const b = await this.call('/api/kestrel/settings', { method: 'POST', body: { settings } })
    return { ok: true, rev: b && b.rev, settings: b && b.settings }
  }

  /** The room from a Home Assistant sensor; `here` reports where the watch placed itself. -> { room } */
  async room({ here = null } = {}) {
    const b = await this.call(`/api/kestrel/room${here ? `?here=${encodeURIComponent(here)}` : ''}`)
    return { room: (b && b.room) || null }
  }

  /** Run an action on a target (Home Assistant drops repeated seqs). -> { ok, state, needsConfirm, error } */
  async fire({ target, action = 'toggle', value, seq, confirmed = false, via, room } = {}) {
    return this.call('/api/kestrel/fire', { method: 'POST', body: { target, action, value, seq, confirmed, via, room } })
  }

  /** A probe result or trail, kept in Home Assistant. -> { forwarded } */
  async probeLog(entry) {
    await this.call('/api/kestrel/probe', { method: 'POST', body: entry })
    return { forwarded: true }
  }

  /** Round trip to Home Assistant, for the latency probe. -> { ok, haMs } */
  async haPing() {
    const t0 = Date.now()
    await this.call('/api/kestrel/targets')
    return { ok: true, haMs: Date.now() - t0 }
  }

  /** Right after pairing: take over another watch's setup. -> { ok, watchId } */
  async takeOver({ from } = {}) {
    const b = await this.call('/api/kestrel/takeover', { method: 'POST', body: { from: String(from || '') } })
    return { ok: true, watchId: b && b.watch_id }
  }
}
