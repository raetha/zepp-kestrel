// Home Assistant client used by the side service (phone). Pure logic: the
// network call (`fetch`) and persistent storage (`store`) are injected, so
// Node tests can drive it with fakes.
//
// Two backends:
//  - component: the WristWand HA component's /api/wristwand/* endpoints, with a
//    per-watch token from pairing (preferred; no long-lived HA token needed).
//  - direct: HA core REST API with a long-lived token from the settings page
//    (store installs that don't use the component).
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

export const SUPPORTED_DOMAINS = [
  'light', 'switch', 'fan', 'media_player', 'lock', 'cover', 'climate',
  'scene', 'script', 'button', 'input_boolean',
]

const KEY = {
  pairing: 'ww.pairing', // JSON { token, watchId, haName, urls: [..], lastGood }
  lastGood: 'ww.lastGoodUrl',
  haUrl: 'haUrl', // settings page (direct mode)
  haToken: 'haToken',
}

const TOKEN_HEADER = 'X-WristWand-Token'
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

  directConfig() {
    const url = normalizeUrl(this.store.getItem(KEY.haUrl))
    const token = (this.store.getItem(KEY.haToken) || '').trim()
    return url && token ? { url, token } : null
  }

  status() {
    const p = this.pairing()
    if (p && p.token) return { paired: true, mode: 'component', haName: p.haName || 'Home Assistant' }
    if (this.directConfig()) return { paired: true, mode: 'direct', haName: 'Home Assistant' }
    return { paired: false, mode: null }
  }

  // ---------------------------------------------------------------- discovery and pairing
  /** Probe likely local addresses (and any saved ones) for the WristWand component. */
  async discover(extra = []) {
    extra = extra.flatMap((a) => expandAddress(a))
    const p = this.pairing()
    const direct = this.directConfig()
    const urls = [...new Set([...extra, ...(p ? p.urls : []), direct && direct.url, ...DISCOVERY_CANDIDATES]
      .filter(Boolean).map(normalizeUrl))]
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await this.fetch({ url: `${url}/api/wristwand/info`, method: 'GET', timeout: LOCAL_TIMEOUT })
          const info = parseBody(res)
          if (res.status === 200 && info && info.name === 'WristWand') {
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
      url: `${url}/api/wristwand/pair`,
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
      url: `${url}/api/wristwand/pair/confirm`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairing_id: pairingId, code: String(code) }),
      timeout: REMOTE_TIMEOUT,
    })
    const b = parseBody(res) || {}
    if (res.status !== 200) return { ok: false, error: b.message || `Home Assistant answered ${res.status}` }
    const urls = [url, b.urls && b.urls.internal, b.urls && b.urls.external].filter(Boolean).map(normalizeUrl)
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
  /** URLs to try, best first: the last one that worked, then local, then remote. */
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
        this.remember(url)
        const b = parseBody(res)
        if (res.status !== 200) throw Object.assign(new Error((b && b.message) || `HA answered ${res.status}`), { fatal: true })
        return b
      } catch (e) {
        if (e.fatal) throw e
        lastErr = e
      }
    }
    throw new Error(`Home Assistant not reachable${lastErr ? `: ${lastErr.message || lastErr}` : ''}`)
  }

  async direct(path, { method = 'GET', body } = {}) {
    const cfg = this.directConfig()
    if (!cfg) throw new Error('Not set up')
    const res = await this.fetch({
      url: `${cfg.url}${path}`,
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: REMOTE_TIMEOUT,
    })
    const b = parseBody(res)
    if (res.status !== 200) throw new Error((b && b.message) || `HA answered ${res.status}`)
    return b
  }

  /** Targets the watch can paint: [{ id, name, domain, area, dimmable, confirm }] */
  async targets() {
    if (this.status().mode === 'component') {
      const b = await this.component('/api/wristwand/targets')
      return (b && b.targets) || []
    }
    // direct mode: every supported entity, no areas (the component adds labels and areas)
    const states = (await this.direct('/api/states')) || []
    return states
      .filter((s) => SUPPORTED_DOMAINS.includes(s.entity_id.split('.')[0]))
      .map((s) => {
        const domain = s.entity_id.split('.')[0]
        const modes = (s.attributes && s.attributes.supported_color_modes) || []
        return {
          id: s.entity_id,
          name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
          domain,
          area: null,
          dimmable: domain === 'light' && modes.some((m) => m !== 'onoff'),
          confirm: domain === 'lock',
        }
      })
  }

  /**
   * Everything the watch keeps in sync (component), or just the targets (direct
   * mode: nothing else is kept in Home Assistant). `only` limits it to some
   * sections, e.g. ['paints'], skipping the large target list.
   * -> { targets, areas, settings, paints, rooms, settings_rev, paints_rev, rooms_rev, room }
   */
  async sync(only = null) {
    if (this.status().mode === 'component') {
      return (await this.component(`/api/wristwand/sync${only ? `?only=${only.join(',')}` : ''}`)) || {}
    }
    return { targets: only ? undefined : await this.targets() }
  }

  /** Send one section after a change on the watch: paints, rooms (component only). -> { ok, rev } */
  async saveSection(section, value) {
    if (this.status().mode !== 'component') return { ok: false, error: 'Needs the WristWand integration' }
    const b = await this.component(`/api/wristwand/${section}`, { method: 'POST', body: { [section]: value } })
    return { ok: true, rev: b && b.rev }
  }

  /** Send the gesture calibration. -> { ok, rev, settings } */
  async saveGesture(gesture) {
    if (this.status().mode !== 'component') return { ok: false, error: 'Needs the WristWand integration' }
    const b = await this.component('/api/wristwand/gesture', { method: 'POST', body: { gesture } })
    return { ok: true, rev: b && b.rev, settings: b && b.settings }
  }

  /** The current room from a Home Assistant sensor, if one is configured. -> { id, name } | null */
  async room() {
    if (this.status().mode !== 'component') return null
    const b = await this.component('/api/wristwand/room')
    return (b && b.room) || null
  }

  /** Run an action on a target. Returns { ok, state, needsConfirm, error } */
  async fire({ target, action = 'toggle', value, seq, confirmed = false }) {
    if (this.status().mode === 'component') {
      return this.component('/api/wristwand/fire', {
        method: 'POST',
        body: { target, action, value, seq, confirmed },
      })
    }
    let current = null
    if (target.startsWith('lock.') && confirmed) {
      const st = await this.direct(`/api/states/${target}`)
      current = st && st.state
    }
    const call = directServiceCall(target, action, value, confirmed, current)
    if (call.needsConfirm) return { ok: false, needsConfirm: true }
    await this.direct(`/api/services/${call.domain}/${call.service}`, { method: 'POST', body: call.data })
    return { ok: true }
  }
}

/** Which HA service a watch action maps to (direct mode; the component has its own copy). */
export function directServiceCall(target, action, value, confirmed, currentState = null) {
  const domain = target.split('.')[0]
  const data = { entity_id: target }
  if (action === 'dim') {
    return { domain: 'light', service: 'turn_on', data: { ...data, brightness_step_pct: Number(value) || 0 } }
  }
  switch (domain) {
    case 'scene':
    case 'script':
      return { domain, service: 'turn_on', data }
    case 'button':
      return { domain, service: 'press', data }
    case 'media_player':
      return { domain, service: 'media_play_pause', data }
    case 'lock':
      if (!confirmed) return { needsConfirm: true }
      return { domain, service: currentState === 'locked' ? 'unlock' : 'lock', data }
    default:
      return { domain: 'homeassistant', service: 'toggle', data }
  }
}
