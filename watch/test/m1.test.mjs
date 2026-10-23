import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeSpot, addSpot, MAX_SPOTS } from '../lib/paint.js'
import { scoreSpot, rank, Aimer, STATE } from '../lib/classifier.js'
import { HaClient, directServiceCall, normalizeUrl, expandAddress, DISCOVERY_CANDIDATES } from '../lib/ha-client.js'

// ------------------------------------------------------------------ painting
function sweep(center, pitch, n = 40, width = 10) {
  return Array.from({ length: n }, (_, i) => ({
    heading: (center + ((i / (n - 1)) - 0.5) * width + 360) % 360,
    pitch: pitch + ((i % 5) - 2),
  }))
}

test('makeSpot averages a sweep across north', () => {
  const s = makeSpot(sweep(358, 10), 123)
  assert.ok(s.heading > 355 || s.heading < 1, `heading ${s.heading}`)
  assert.ok(s.headingSpread > 0 && s.headingSpread < 10)
  assert.equal(s.pitch, 10)
  assert.ok(s.pitchSpread > 0)
  assert.equal(s.n, 40)
  assert.equal(s.at, 123)
})

test('makeSpot rejects short or invalid paints', () => {
  assert.equal(makeSpot(sweep(90, 0, 5)), null)
  assert.equal(makeSpot(Array.from({ length: 30 }, () => ({ heading: null, pitch: 0 }))), null)
})

test('addSpot keeps the newest spots', () => {
  let spots = []
  for (let i = 0; i < MAX_SPOTS + 2; i++) spots = addSpot(spots, { id: i })
  assert.equal(spots.length, MAX_SPOTS)
  assert.equal(spots[0].id, 2)
})

// ------------------------------------------------------------------ classifier
const lamp = { id: 'light.lamp', spots: [{ heading: 90, headingSpread: 4, pitch: 0, pitchSpread: 3 }] }
const tv = { id: 'media_player.tv', spots: [{ heading: 180, headingSpread: 4, pitch: -10, pitchSpread: 3 }] }
const fan = { id: 'fan.ceiling', spots: [{ heading: 95, headingSpread: 4, pitch: 50, pitchSpread: 3 }] }

test('scoreSpot peaks at the spot and handles wraparound', () => {
  const s = { heading: 2, headingSpread: 4, pitch: 0, pitchSpread: 3 }
  assert.equal(scoreSpot(s, 2, 0), 1)
  assert.ok(scoreSpot(s, 358, 0) > 0.6)
  assert.ok(scoreSpot(s, 60, 0) < 0.001)
})

test('rank separates devices by pitch at the same heading', () => {
  assert.equal(rank([lamp, fan, tv], 92, 2)[0].id, 'light.lamp')
  assert.equal(rank([lamp, fan, tv], 92, 48)[0].id, 'fan.ceiling')
  assert.equal(rank([{ id: 'x', spots: [] }], 0, 0).length, 0)
})

test('Aimer: resting, aiming, candidate, then locked after the hold', () => {
  const a = new Aimer()
  const devices = [lamp, tv]
  assert.equal(a.update(0, false, devices, 90, 0).state, STATE.RESTING)
  assert.equal(a.update(10, true, devices, 135, 0).state, STATE.AIMING)
  let r = a.update(100, true, devices, 90, 0)
  assert.equal(r.state, STATE.CANDIDATE)
  assert.equal(r.best.id, 'light.lamp')
  assert.equal(a.update(300, true, devices, 90, 0).state, STATE.CANDIDATE)
  r = a.update(360, true, devices, 91, 0)
  assert.equal(r.state, STATE.LOCKED)
  // drifting to the TV restarts the hold
  assert.equal(a.update(400, true, devices, 180, -10).state, STATE.CANDIDATE)
})

test('Aimer does not lock when two devices are equally likely', () => {
  const a = new Aimer()
  const twins = [lamp, { id: 'light.twin', spots: lamp.spots }]
  a.update(0, true, twins, 90, 0)
  assert.equal(a.update(1000, true, twins, 90, 0).state, STATE.CANDIDATE)
})

// ------------------------------------------------------------------ HA client
function memStore(init = {}) {
  const m = { ...init }
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v }, m }
}

function fakeFetch(routes) {
  const calls = []
  const fn = async (req) => {
    calls.push(req)
    const handler = routes[`${req.method} ${req.url}`]
    if (!handler) throw new Error('unreachable')
    return handler(req)
  }
  fn.calls = calls
  return fn
}

test('normalizeUrl trims slashes and spaces', () => {
  assert.equal(normalizeUrl(' http://ha.local:8123/ '), 'http://ha.local:8123')
})

test('discover finds the component and de-duplicates by HA name', async () => {
  const info = async () => ({ status: 200, body: JSON.stringify({ name: 'WristWand', ha_name: 'Home', version: '0.1.0' }) })
  const fetch = fakeFetch({
    'GET http://homeassistant.local:8123/api/wristwand/info': info,
    'GET http://homeassistant:8123/api/wristwand/info': info,
  })
  const ha = new HaClient({ fetch, store: memStore() })
  const found = await ha.discover()
  assert.equal(found.length, 1)
  assert.equal(found[0].haName, 'Home')
})

test('pairing stores the token and every address HA reports', async () => {
  const fetch = fakeFetch({
    'POST http://homeassistant.local:8123/api/wristwand/pair': async (r) => {
      assert.equal(JSON.parse(r.body).watch_name, 'Balance 3')
      return { status: 200, body: { pairing_id: 'p1', expires_in: 600 } }
    },
    'POST http://homeassistant.local:8123/api/wristwand/pair/confirm': async (r) => {
      const b = JSON.parse(r.body)
      if (b.code !== '123456') return { status: 403, body: { message: 'Wrong code' } }
      return {
        status: 200,
        body: { token: 'tok', watch_id: 'w1', ha_name: 'Home', urls: { internal: 'http://192.168.1.5:8123', external: 'https://abc.ui.nabu.casa' } },
      }
    },
  })
  const store = memStore()
  const ha = new HaClient({ fetch, store })
  const start = await ha.pairStart('http://homeassistant.local:8123/', 'Balance 3')
  assert.equal(start.pairingId, 'p1')
  assert.deepEqual(await ha.pairConfirm(start.url, 'p1', 111111), { ok: false, error: 'Wrong code' })
  assert.equal(ha.status().paired, false)
  assert.deepEqual(await ha.pairConfirm(start.url, 'p1', 123456), { ok: true, haName: 'Home' })
  assert.deepEqual(ha.status(), { paired: true, mode: 'component', haName: 'Home' })
  assert.deepEqual(ha.pairing().urls, ['http://homeassistant.local:8123', 'http://192.168.1.5:8123', 'https://abc.ui.nabu.casa'])
})

test('component requests fall back from local to Nabu Casa, then remember what worked', async () => {
  const store = memStore({
    'ww.pairing': JSON.stringify({ token: 'tok', urls: ['http://homeassistant.local:8123', 'https://abc.ui.nabu.casa'] }),
  })
  const fetch = fakeFetch({
    'GET https://abc.ui.nabu.casa/api/wristwand/targets': async (r) => {
      assert.equal(r.headers['X-WristWand-Token'], 'tok')
      return { status: 200, body: { targets: [{ id: 'light.lamp' }] } }
    },
  })
  const ha = new HaClient({ fetch, store })
  assert.deepEqual(await ha.targets(), [{ id: 'light.lamp' }])
  assert.equal(fetch.calls[0].url.startsWith('http://homeassistant.local'), true)
  assert.equal(store.m['ww.lastGoodUrl'], 'https://abc.ui.nabu.casa')
  await ha.targets()
  assert.equal(fetch.calls[2].url.startsWith('https://abc.ui.nabu.casa'), true)
})

test('a 401 from the component unpairs the watch', async () => {
  const store = memStore({ 'ww.pairing': JSON.stringify({ token: 'tok', urls: ['http://homeassistant.local:8123'] }) })
  const fetch = fakeFetch({ 'GET http://homeassistant.local:8123/api/wristwand/targets': async () => ({ status: 401, body: {} }) })
  const ha = new HaClient({ fetch, store })
  await assert.rejects(ha.targets(), /pair again/)
  assert.equal(ha.status().paired, false)
})

test('direct mode lists supported entities and maps actions to services', async () => {
  const store = memStore({ haUrl: 'https://ha.example/', haToken: 'llt' })
  const fetch = fakeFetch({
    'GET https://ha.example/api/states': async () => ({
      status: 200,
      body: [
        { entity_id: 'light.lamp', attributes: { friendly_name: 'Lamp', supported_color_modes: ['brightness'] } },
        { entity_id: 'sensor.temp', attributes: {} },
        { entity_id: 'lock.door', attributes: { friendly_name: 'Door' } },
      ],
    }),
    'POST https://ha.example/api/services/homeassistant/toggle': async (r) => {
      assert.equal(r.headers.Authorization, 'Bearer llt')
      return { status: 200, body: [] }
    },
  })
  const ha = new HaClient({ fetch, store })
  const t = await ha.targets()
  assert.deepEqual(t.map((x) => [x.id, x.dimmable, x.confirm]), [['light.lamp', true, false], ['lock.door', false, true]])
  assert.deepEqual(await ha.fire({ target: 'light.lamp' }), { ok: true })
  assert.deepEqual(await ha.fire({ target: 'lock.door' }), { ok: false, needsConfirm: true })
})

test('directServiceCall covers each domain', () => {
  assert.equal(directServiceCall('scene.movie').service, 'turn_on')
  assert.equal(directServiceCall('button.bell').service, 'press')
  assert.equal(directServiceCall('media_player.tv').service, 'media_play_pause')
  assert.deepEqual(directServiceCall('light.lamp', 'dim', -10).data, { entity_id: 'light.lamp', brightness_step_pct: -10 })
  assert.equal(directServiceCall('lock.door', 'toggle', null, true, 'locked').service, 'unlock')
  assert.equal(directServiceCall('lock.door', 'toggle', null, true, 'unlocked').service, 'lock')
})

test('spotProblem flags too few samples and unsteady compass readings', async () => {
  const { spotProblem } = await import('../lib/paint.js')
  assert.equal(spotProblem(null), 'few')
  assert.equal(spotProblem(makeSpot(sweep(90, 0))), null)
  assert.equal(spotProblem(makeSpot(sweep(90, 0, 40, 200))), 'unsteady')
})

test('discovery tries port 80 and 8123, and typed addresses', async () => {
  assert.ok(DISCOVERY_CANDIDATES.includes('http://homeassistant.local'))
  assert.ok(DISCOVERY_CANDIDATES.includes('http://homeassistant.local:8123'))
  assert.deepEqual(expandAddress('192.168.1.20'), ['http://192.168.1.20', 'http://192.168.1.20:8123'])
  assert.deepEqual(expandAddress('192.168.1.20:9000'), ['http://192.168.1.20:9000'])
  assert.deepEqual(expandAddress('https://ha.example/'), ['https://ha.example'])
  const fetch = fakeFetch({
    'GET http://192.168.1.20:9000/api/wristwand/info': async () => ({ status: 200, body: { name: 'WristWand', ha_name: 'Lab' } }),
  })
  const found = await new HaClient({ fetch, store: memStore() }).discover(['192.168.1.20:9000'])
  assert.deepEqual(found, [{ url: 'http://192.168.1.20:9000', haName: 'Lab', version: undefined }])
})

test('corrections add small spots without pushing painted ones out', async () => {
  const { correctionSpot, addCorrection, MAX_CORRECTIONS, MAX_SPOTS: max } = await import('../lib/paint.js')
  assert.equal(correctionSpot(NaN, 3), null)
  const painted = Array.from({ length: max }, (_, i) => ({ heading: i, headingSpread: 5, pitch: 0, pitchSpread: 3, n: 30 }))
  let spots = painted
  for (let i = 0; i < 4; i++) spots = addCorrection(spots, correctionSpot(100 + i, 5, i))
  assert.equal(spots.filter((s) => s.kind === 'correction').length, MAX_CORRECTIONS)
  assert.deepEqual(spots.slice(0, max), painted)
  assert.deepEqual(spots.slice(max).map((s) => s.heading), [102, 103])
  assert.deepEqual(addCorrection(undefined, null), [])
  // a correction spot ranks its device first where the user aimed
  const devices = [
    { id: 'light.a', spots: [{ heading: 100, headingSpread: 10, pitch: 5, pitchSpread: 5 }] },
    { id: 'light.b', spots: addCorrection([{ heading: 120, headingSpread: 10, pitch: 5, pitchSpread: 5 }], correctionSpot(104, 5)) },
  ]
  assert.equal(rank(devices, 104, 5)[0].id, 'light.b')
})

test('sync, section saves, gesture and room go to the component', async () => {
  const url = 'http://homeassistant.local'
  const store = memStore({ 'ww.pairing': JSON.stringify({ token: 'tok', urls: [url] }) })
  const fetch = fakeFetch({
    [`GET ${url}/api/wristwand/sync`]: async () => ({ status: 200, body: { targets: [], paints: {}, paints_rev: 2 } }),
    [`GET ${url}/api/wristwand/sync?only=paints`]: async () => ({ status: 200, body: { paints: {}, paints_rev: 2 } }),
    [`POST ${url}/api/wristwand/paints`]: async (r) => {
      assert.deepEqual(JSON.parse(r.body), { paints: { 'light.a': [] } })
      return { status: 200, body: { ok: true, rev: 3 } }
    },
    [`POST ${url}/api/wristwand/gesture`]: async () => ({ status: 200, body: { ok: true, rev: 4, settings: { gesture: { gyro: 500 } } } }),
    [`GET ${url}/api/wristwand/room`]: async () => ({ status: 200, body: { room: { id: 'office', name: 'Office' } } }),
  })
  const ha = new HaClient({ fetch, store })
  assert.equal((await ha.sync()).paints_rev, 2)
  assert.deepEqual(await ha.sync(['paints']), { paints: {}, paints_rev: 2 })
  assert.deepEqual(await ha.saveSection('paints', { 'light.a': [] }), { ok: true, rev: 3 })
  assert.equal((await ha.saveGesture({ gyro: 500 })).settings.gesture.gyro, 500)
  assert.deepEqual(await ha.room(), { id: 'office', name: 'Office' })

  // direct mode: targets only, nothing kept in Home Assistant
  const direct = new HaClient({
    fetch: fakeFetch({ 'GET https://ha.example/api/states': async () => ({ status: 200, body: [] }) }),
    store: memStore({ haUrl: 'https://ha.example/', haToken: 'llt' }),
  })
  assert.deepEqual(await direct.sync(), { targets: [] })
  assert.equal((await direct.saveSection('paints', {})).ok, false)
  assert.equal((await direct.saveGesture({})).ok, false)
  assert.equal(await direct.room(), null)
})
