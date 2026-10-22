// Home Assistant access from the phone. The watch never sees the token.
//
// Two backends will live here:
//  - direct: HA core REST API with a long-lived token (works everywhere)
//  - component: the optional `wristwand` custom component's /api/wristwand/*
// detect() picks one; M0 only needs ping and event forwarding.

export function haConfig(settings) {
  const url = (settings.getItem('haUrl') || '').trim().replace(/\/+$/, '')
  const token = (settings.getItem('haToken') || '').trim()
  return url && token ? { url, token } : null
}

function headers(cfg) {
  return { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }
}

function bodyJson(res) {
  if (!res || res.body === undefined || res.body === null) return null
  if (typeof res.body === 'string') {
    try {
      return JSON.parse(res.body)
    } catch (e) {
      return null
    }
  }
  return res.body
}

/** GET /api/ — HA answers {"message": "API running."}. Returns timing. */
export async function haPing(svc, cfg) {
  const t0 = Date.now()
  const res = await svc.fetch({ url: `${cfg.url}/api/`, method: 'GET', headers: headers(cfg) })
  const haMs = Date.now() - t0
  if (res.status !== 200) return { ok: false, status: res.status, haMs, error: `HA returned ${res.status}` }
  return { ok: true, status: res.status, haMs }
}

/** Is the optional custom component installed? (404 = no) */
export async function detectComponent(svc, cfg) {
  try {
    const res = await svc.fetch({ url: `${cfg.url}/api/wristwand/info`, method: 'GET', headers: headers(cfg) })
    return res.status === 200 ? bodyJson(res) : null
  } catch (e) {
    return null
  }
}

/** Fire an HA event; used to forward probe results into HA. */
export async function fireEvent(svc, cfg, eventType, data) {
  const res = await svc.fetch({
    url: `${cfg.url}/api/events/${eventType}`,
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(data),
  })
  return res.status === 200
}
