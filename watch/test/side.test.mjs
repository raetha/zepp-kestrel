// The phone side (lib/side.js) as the Zepp app runs it: requests from the watch,
// the relay to Kestrel's endpoints, and the settings page's storage keys.
import test from 'node:test'
import assert from 'node:assert/strict'

import { sideService } from '../lib/side.js'
import { METHOD } from '../lib/protocol.js'
import { RELAY_MAX_BODY } from '../lib/ha-api.js'
import { BUILD } from '../lib/version.js'

const HA = 'http://192.168.1.20'

function storage(items = {}) {
  const m = { ...items }
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => (m[k] = String(v)) }
}

/** A side service with fake storage and network, started as ZML would. */
function start({ paired = true, routes = {} } = {}) {
  const settings = storage(paired ? { 'kestrel.pairing': JSON.stringify({ token: 'tok', watchId: 'w1', haName: 'Home', urls: [HA] }) } : {})
  const sent = []
  const svc = sideService()
  svc.settings = settings
  svc.fetch = async (req) => {
    sent.push(req)
    const key = `${req.method} ${req.url.replace(HA, '')}`
    const route = routes[key] || routes[key.split('?')[0]]
    if (!route) return { status: 404, body: { message: 'no route' } }
    return route(req)
  }
  const log = console.log
  console.log = () => {}
  try {
    svc.onInit()
  } finally {
    console.log = log
  }
  const call = (method, params) => new Promise((resolve) => svc.onRequest({ method, params }, (err, r) => resolve(err || r)))
  return { svc, settings, sent, call }
}

test('the phone side reports its build and pairing', async () => {
  const { settings, call } = start()
  assert.equal(settings.m['kestrel.sideBuild'], BUILD) // the settings page's Version card reads it
  assert.deepEqual(await call(METHOD.STATUS), { paired: true, haName: 'Home', url: HA, build: BUILD })
  assert.ok((await call(METHOD.PING)).t > 0)
  const unpaired = start({ paired: false })
  assert.deepEqual(await unpaired.call(METHOD.STATUS), { paired: false, build: BUILD })
})

test('relays the watch’s requests to Kestrel’s endpoints, with the token and its build', async () => {
  const { sent, call } = start({ routes: { 'POST /api/kestrel/fire': async () => ({ status: 200, body: { ok: true, state: 'on' } }) } })
  const r = await call(METHOD.RELAY, { path: '/api/kestrel/fire', method: 'POST', body: { target: 'light.lamp', seq: 1 } })
  assert.deepEqual(r, { relayed: true, body: { ok: true, state: 'on' } })
  assert.equal(sent[0].url, `${HA}/api/kestrel/fire`)
  assert.equal(sent[0].headers['X-Kestrel-Token'], 'tok')
  assert.equal(sent[0].headers['X-Kestrel-Side'], BUILD)
  assert.deepEqual(JSON.parse(sent[0].body), { target: 'light.lamp', seq: 1 })
})

test('refuses anything but Kestrel’s endpoints, and oversized bodies, without a network call', async () => {
  const { sent, call } = start()
  for (const params of [
    { path: '/api/states', method: 'GET' }, // Home Assistant's own API
    { path: '/api/kestrel/../states', method: 'GET' },
    { path: 'http://elsewhere/api/kestrel/fire', method: 'POST' },
    { path: '/api/kestrel/fire', method: 'DELETE' },
    { path: '/api/kestrel/probe', method: 'POST', body: { raw: 'x'.repeat(RELAY_MAX_BODY) } },
    {},
  ]) {
    const r = await call(METHOD.RELAY, params)
    assert.equal(r.ok, false)
    assert.match(r.error, /Not a Kestrel request/)
  }
  assert.equal(sent.length, 0)
  assert.match((await call('kestrel.sync', {})).error, /unknown method kestrel.sync/) // the watch shows a phone mismatch
})

test('a relay before pairing, or after Home Assistant removed the watch, says to pair', async () => {
  assert.match((await start({ paired: false }).call(METHOD.RELAY, { path: '/api/kestrel/sync' })).error, /Not paired/)
  const removed = start({ routes: { 'GET /api/kestrel/sync': async () => ({ status: 401, body: {} }) } })
  assert.match((await removed.call(METHOD.RELAY, { path: '/api/kestrel/sync' })).error, /pair again/)
  assert.equal((await removed.call(METHOD.STATUS)).paired, false) // the token is forgotten
})

test('keeps the settings page’s copies current, and never fails a request over storage', async () => {
  const settingsReply = { ok: true, settings: { gesture: { enabled: true } } }
  const { settings, call } = start({
    routes: {
      'GET /api/kestrel/sync': async () => ({ status: 200, body: { watch_id: 'w1', settings: { gesture: { enabled: false } } } }),
      'POST /api/kestrel/probe': async () => ({ status: 200, body: { ok: true } }),
      'POST /api/kestrel/settings': async () => ({ status: 200, body: settingsReply }),
    },
  })
  await call(METHOD.RELAY, { path: '/api/kestrel/sync?v=1', method: 'GET' })
  assert.deepEqual(JSON.parse(settings.m['kestrel.settings']), { gesture: { enabled: false } })

  // probes run on purpose are listed on the settings page (a summary); traces and trails aren't
  await call(METHOD.RELAY, { path: '/api/kestrel/probe', method: 'POST', body: { test: 'snap', at: 1, raw: [1, 2, 3] } })
  await call(METHOD.RELAY, { path: '/api/kestrel/probe', method: 'POST', body: { test: 'trail', at: 2, trail: [] } })
  assert.deepEqual(JSON.parse(settings.m.probeLog), [{ test: 'snap', at: 1 }])

  // storage that throws: the request still succeeds
  settings.setItem = () => {
    throw new Error('full')
  }
  const r = await call(METHOD.RELAY, { path: '/api/kestrel/sync?v=1', method: 'GET' })
  assert.equal(r.relayed, true)
})

test('a change on the settings page goes to Home Assistant, and the page hears how it went', async () => {
  const posted = []
  const { svc, settings } = start({
    routes: {
      'POST /api/kestrel/settings': async (req) => {
        posted.push(JSON.parse(req.body))
        return { status: 200, body: { rev: 3, settings: { screen: { seconds: 60 } } } }
      },
    },
  })
  settings.setItem('kestrel.settingsEdit', JSON.stringify({ settings: { screen: { seconds: 60 } }, at: 1 }))
  await svc.applySettingsEdit()
  assert.deepEqual(posted, [{ settings: { screen: { seconds: 60 } } }])
  assert.match(settings.m['kestrel.settingsResult'], /^Saved/)
  assert.deepEqual(JSON.parse(settings.m['kestrel.settings']), { screen: { seconds: 60 } })

  settings.setItem('kestrel.settingsEdit', 'not json')
  await svc.applySettingsEdit() // ignored
  svc.onSettingsChange({ key: 'clearLog' })
  assert.equal(settings.m.probeLog, '[]')
})
