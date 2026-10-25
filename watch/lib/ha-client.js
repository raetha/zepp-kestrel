// Home Assistant client used by the side service (phone). Pure logic: the
// network call (`fetch`) and persistent storage (`store`) are injected, so
// Node tests can drive it with fakes.
//
// It talks only to the Kestrel integration's /api/kestrel/* endpoints, with
// the per-watch token from pairing: never Home Assistant's own API, never a
// long-lived token, and only on the home network.
//
//   fetch({ url, method, headers, body, timeout }) -> Promise<{ status, body }>
//   store.getItem(key) -> string | null ; store.setItem(key, string)

// New Home Assistant OS installs (2026.8+) listen on port 80; older installs and
// containers on 8123. Users with another port or name can type an address on the watch.
export const DISCOVERY_CANDIDATES = [
  'http://homeassistant.local',
  'http://homeassistant.local:8123',
  'http://homeassistant',
  'http://homeassistant:8123',
  'https://homeassistant.local',
  'https://homeassistant.local:8123',
]

/**
 * URLs to try for an address typed on the watch: "192.168.1.20", "192.168.1.20:8123"
 * or a full URL. Without a port, try 80 and 8123.
 */
export function expandAddress(text) {
  const t = (text || '').trim().replace(/\/+$/, '')
  if (!t) return []
  if (/^https?:\/\//i.test(t)) return [t]
  if (/:\d+$/.test(t)) return [`http://${t}`]
  return [`http://${t}`, `http://${t}:8123`]
}

const KEY = {
  pairing: 'kestrel.pairing', // JSON { token, watchId, haName, urls: [..], lastGood }
  lastGood: 'kestrel.lastGoodUrl',
}

const TOKEN_HEADER = 'X-Kestrel-Token'
const LOCAL_TIMEOUT = 2500
const REMOTE_TIMEOUT = 8000

export function normalizeUrl(u) {
  return (u || '').trim().replace(/\/+$/, '')
}

function isLocal(url) {
  return /\.local(:|\/|$)|\/\/(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.|\/\/homeassistant(:|\/|$)/.test(url)
}

function parseBody(res) {
  if (!res) return null
  const b = res.body
  if (b === undefined || b === null || b === '') return null
  if (typeof b === 'string') {
    try {
      return JSON.parse(b)
    } catch (e) {
      return b
    }
  }
  return b
}

export class HaClient {
  constructor({ fetch, store }) {
    this.fetch = fetch
    this.store = store
  }

  // ---------------------------------------------------------------- state
  pairing() {
    try {
      return JSON.parse(this.store.getItem(KEY.pairing) || 'null')
    } catch (e) {
      return null
    }
  }

  savePairing(p) {
    this.store.setItem(KEY.pairing, JSON.stringify(p))
  }

  unpair() {
    this.store.setItem(KEY.pairing, 'null')
  }

  status() {
    const p = this.pairing()
    if (p && p.token) return { paired: true, haName: p.haName || 'Home Assistant', url: this.candidateUrls()[0] || null }
    return { paired: false }
  }

  // ---------------------------------------------------------------- discovery and pairing
  /** Probe likely local addresses (and any saved ones) for the Kestrel component. */
  async discover(extra = []) {
    extra = extra.flatMap((a) => expandAddress(a))
    const p = this.pairing()
    const urls = [...new Set([...extra, ...(p ? p.urls : []), ...DISCOVERY_CANDIDATES]
      .filter(Boolean).map(normalizeUrl))]
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await this.fetch({ url: `${url}/api/kestrel/info`, method: 'GET', timeout: LOCAL_TIMEOUT })
          const info = parseBody(res)
          if (res.status === 200 && info && info.name === 'Kestrel') {
            return { url, haName: info.ha_name || 'Home Assistant', version: info.version }
          }
        } catch (e) {
          // not there
        }
        return null
      }),
    )
    // The same HA can answer on several names: keep one entry per HA name.
    const seen = new Set()
    return results.filter((r) => r && !seen.has(r.haName) && seen.add(r.haName))
  }

  async pairStart(url, watchName) {
    url = normalizeUrl(url)
    const res = await this.fetch({
      url: `${url}/api/kestrel/pair`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watch_name: watchName || 'Amazfit watch' }),
      timeout: REMOTE_TIMEOUT,
    })
    const b = parseBody(res) || {}
    if (res.status !== 200) throw new Error(b.message || `Home Assistant answered ${res.status}`)
    return { url, pairingId: b.pairing_id, expiresIn: b.expires_in }
  }

  async pairConfirm(url, pairingId, code) {
    url = normalizeUrl(url)
    const res = await this.fetch({
      url: `${url}/api/kestrel/pair/confirm`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairing_id: pairingId, code: String(code) }),
      timeout: REMOTE_TIMEOUT,
    })
    const b = parseBody(res) || {}
    if (res.status !== 200) return { ok: false, error: b.message || `Home Assistant answered ${res.status}` }
    // the address that answered, and Home Assistant's own home-network address (never a cloud one)
    const urls = [url, b.urls && b.urls.internal].filter(Boolean).map(normalizeUrl)
    this.savePairing({
      token: b.token,
      watchId: b.watch_id,
      haName: b.ha_name || 'Home Assistant',
      urls: [...new Set(urls)],
    })
    this.store.setItem(KEY.lastGood, url)
    return { ok: true, haName: b.ha_name || 'Home Assistant' }
  }

  /** Note the address that answered; storage trouble never fails a request. */
  remember(url) {
    try {
      if (this.store.getItem(KEY.lastGood) !== url) this.store.setItem(KEY.lastGood, url)
    } catch (e) {
      // best effort
    }
  }

  // ---------------------------------------------------------------- requests
  /** URLs to try, best first: the last one that worked, then the rest (all home-network addresses). */
  candidateUrls() {
    const p = this.pairing()
    const urls = p ? p.urls : []
    const last = normalizeUrl(this.store.getItem(KEY.lastGood))
    const ordered = [last, ...urls.filter(isLocal), ...urls.filter((u) => !isLocal(u))].filter(Boolean)
    return [...new Set(ordered)].filter((u) => urls.includes(u))
  }

  /** Call a component endpoint, trying each known address until one answers. */
  async component(path, { method = 'GET', body } = {}) {
    const p = this.pairing()
    if (!p || !p.token) throw new Error('Not paired with Home Assistant')
    let lastErr = null
    for (const url of this.candidateUrls()) {
      try {
        const res = await this.fetch({
          url: `${url}${path}`,
          method,
          headers: { [TOKEN_HEADER]: p.token, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          timeout: isLocal(url) ? LOCAL_TIMEOUT : REMOTE_TIMEOUT,
        })
        if (res.status === 401) {
          this.unpair()
          throw Object.assign(new Error('This watch was removed in Home Assistant: pair again'), { fatal: true })
        }
        if (res.status === 403) {
          // reached Home Assistant, but not from the home network (e.g. an old cloud address): try the next one
          const b = parseBody(res)
          lastErr = new Error((b && b.message) || 'Kestrel only works on your home network')
          continue
        }
        this.remember(url)
        const b = parseBody(res)
        if (res.status !== 200) throw Object.assign(new Error((b && b.message) || `HA answered ${res.status}`), { fatal: true })
        return b
      } catch (e) {
        if (e.fatal) throw e
        lastErr = e
      }
    }
    throw new Error(`Home Assistant not reachable (Kestrel works on your home network or a VPN)${lastErr ? `: ${lastErr.message || lastErr}` : ''}`)
  }

  /** Targets the watch can paint: [{ id, name, domain, area, dimmable, confirm }] */
  async targets() {
    const b = await this.component('/api/kestrel/targets')
    return (b && b.targets) || []
  }

  /**
   * Everything the watch keeps in sync. `only` limits it to some
   * sections, e.g. ['paints']; `have` ({ targets: hash, paints: rev, ... })
   * says what the watch already has, so unchanged parts are left out.
   * -> { watch_id, targets?, areas?, targets_hash, settings?, paints?, rooms?, *_rev, room }
   */
  async sync(only = null, have = null, version = null) {
    const q = []
    if (only) q.push(`only=${only.join(',')}`)
    if (have) q.push(`have=${Object.keys(have).map((k) => `${k}:${have[k]}`).join(',')}`)
    if (version) q.push(`v=${encodeURIComponent(version)}`)
    return (await this.component(`/api/kestrel/sync${q.length ? `?${q.join('&')}` : ''}`)) || {}
  }

  /**
   * Only what changed in one section (paints, rooms): { key: new value, or null if removed }.
   * `base` is the revision the watch last had; stale = Home Assistant changed something else since.
   * -> { ok, rev, stale }
   */
  async saveChanges(section, changes, base) {
    const b = await this.component(`/api/kestrel/${section}`, { method: 'POST', body: { changes, base } })
    return { ok: true, rev: b && b.rev, stale: !!(b && b.stale) }
  }

  /** Send a whole section (older watch builds). -> { ok, rev } */
  async saveSection(section, value) {
    const b = await this.component(`/api/kestrel/${section}`, { method: 'POST', body: { [section]: value } })
    return { ok: true, rev: b && b.rev }
  }

  /** Changed settings ({ group: {...} }) from the watch or the settings page. -> { ok, rev, settings } */
  async saveSettings(settings) {
    const b = await this.component('/api/kestrel/settings', { method: 'POST', body: { settings } })
    return { ok: true, rev: b && b.rev, settings: b && b.settings }
  }

  /** The room from a Home Assistant sensor; `here` reports the room the watch placed itself in. */
  async room(here = null) {
    const b = await this.component(`/api/kestrel/room${here ? `?here=${encodeURIComponent(here)}` : ''}`)
    return (b && b.room) || null
  }

  /** Run an action on a target. Returns { ok, state, needsConfirm, error } */
  async fire({ target, action = 'toggle', value, seq, confirmed = false, via, room }) {
    return this.component('/api/kestrel/fire', {
      method: 'POST',
      body: { target, action, value, seq, confirmed, via, room },
    })
  }

  /** Probe results and trails, kept in Home Assistant (diagnostics). */
  async probe(entry) {
    return this.component('/api/kestrel/probe', { method: 'POST', body: entry })
  }

  /** Round trip to Home Assistant, for the latency probe. -> { ok, haMs } */
  async ping() {
    const t0 = Date.now()
    await this.component('/api/kestrel/targets')
    return { ok: true, haMs: Date.now() - t0 }
  }
}
