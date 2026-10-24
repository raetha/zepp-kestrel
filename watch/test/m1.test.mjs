import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeSpot, addSpot, MAX_SPOTS } from '../lib/paint.js'
import { scoreSpot, rank, Aimer, STATE } from '../lib/classifier.js'
import { spotsForRoom } from '../lib/rooms.js'
import { crowdedBy } from '../lib/paint.js'
import { HaClient, normalizeUrl, expandAddress, DISCOVERY_CANDIDATES } from '../lib/ha-client.js'

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

// Spots painted on a real watch from one corner of a kitchen: an island light,
// swept tightly, and a dining-room chandelier 18° away, swept widely.
const island = { id: 'light.island', spots: [{ heading: 277.6, headingSpread: 6.1, pitch: 24.3, pitchSpread: 0.6, room: 'kitchen' }] }
const chandelier = { id: 'light.chandelier', spots: [{ heading: 295.9, headingSpread: 14.3, pitch: 20.9, pitchSpread: 0.7, room: 'dining' }] }

test('a widely swept spot does not claim the space next to a tight one', () => {
  // the boundary falls between the two, not 5° from the island
  assert.equal(rank([island, chandelier], 284, 23)[0].id, 'light.island')
  assert.equal(rank([island, chandelier], 290, 22)[0].id, 'light.chandelier')
  // aimed at the island, it locks (it used to stay a candidate: plain scores 0.96 vs 0.67)
  const a = new Aimer()
  a.update(0, true, [island, chandelier], 278, 24)
  assert.equal(a.update(400, true, [island, chandelier], 278, 24).state, STATE.LOCKED)
})

test('a spot from another room counts less but is not hidden', () => {
  const inDining = [island, chandelier].map((d) => ({ ...d, spots: spotsForRoom(d.spots, 'dining') }))
  // the room was wrong (or you point into the next room): the island still wins where it was painted
  assert.equal(rank(inDining, 276, 24)[0].id, 'light.island')
  assert.equal(rank(inDining, 286, 22)[0].id, 'light.chandelier')
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
  const info = async () => ({ status: 200, body: JSON.stringify({ name: 'Kestrel', ha_name: 'Home', version: '0.1.0' }) })
  const fetch = fakeFetch({
    'GET http://homeassistant.local:8123/api/kestrel/info': info,
    'GET http://homeassistant:8123/api/kestrel/info': info,
  })
  const ha = new HaClient({ fetch, store: memStore() })
  const found = await ha.discover()
  assert.equal(found.length, 1)
  assert.equal(found[0].haName, 'Home')
})

test('pairing stores the token and the home addresses, never a cloud one', async () => {
  const fetch = fakeFetch({
    'POST http://homeassistant.local:8123/api/kestrel/pair': async (r) => {
      assert.equal(JSON.parse(r.body).watch_name, 'Balance 3')
      return { status: 200, body: { pairing_id: 'p1', expires_in: 600 } }
    },
    'POST http://homeassistant.local:8123/api/kestrel/pair/confirm': async (r) => {
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
  assert.deepEqual(ha.status(), { paired: true, haName: 'Home', url: 'http://homeassistant.local:8123' }) // the address that answered
  assert.deepEqual(ha.pairing().urls, ['http://homeassistant.local:8123', 'http://192.168.1.5:8123'])
})

test('requests try the next home address, and skip one Home Assistant refuses as not home', async () => {
  const store = memStore({
    'kestrel.pairing': JSON.stringify({ token: 'tok', urls: ['http://homeassistant.local:8123', 'http://192.168.1.5:8123', 'https://abc.ui.nabu.casa'] }),
    'kestrel.lastGoodUrl': 'https://abc.ui.nabu.casa', // from an older pairing
  })
  const fetch = fakeFetch({
    'GET https://abc.ui.nabu.casa/api/kestrel/targets': async () => ({ status: 403, body: { message: 'Kestrel only works on your home network' } }),
    'GET http://192.168.1.5:8123/api/kestrel/targets': async (r) => {
      assert.equal(r.headers['X-Kestrel-Token'], 'tok')
      return { status: 200, body: { targets: [{ id: 'light.lamp' }] } }
    },
  })
  const ha = new HaClient({ fetch, store })
  assert.deepEqual(await ha.targets(), [{ id: 'light.lamp' }])
  assert.equal(store.m['kestrel.lastGoodUrl'], 'http://192.168.1.5:8123')
  await ha.targets()
  assert.equal(fetch.calls[fetch.calls.length - 1].url.startsWith('http://192.168.1.5'), true)

  // nothing at home answers: say why
  const away = new HaClient({ fetch: fakeFetch({}), store: memStore({ 'kestrel.pairing': JSON.stringify({ token: 'tok', urls: ['http://homeassistant.local:8123'] }) }) })
  await assert.rejects(away.targets(), /home network or a VPN/)
})

test('a 401 from the component unpairs the watch', async () => {
  const store = memStore({ 'kestrel.pairing': JSON.stringify({ token: 'tok', urls: ['http://homeassistant.local:8123'] }) })
  const fetch = fakeFetch({ 'GET http://homeassistant.local:8123/api/kestrel/targets': async () => ({ status: 401, body: {} }) })
  const ha = new HaClient({ fetch, store })
  await assert.rejects(ha.targets(), /pair again/)
  assert.equal(ha.status().paired, false)
})

test('without pairing nothing reaches Home Assistant', async () => {
  const ha = new HaClient({ fetch: async () => assert.fail('no request expected'), store: memStore() })
  assert.deepEqual(ha.status(), { paired: false })
  await assert.rejects(ha.targets(), /Not paired/)
  await assert.rejects(ha.fire({ target: 'light.lamp' }), /Not paired/)
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
    'GET http://192.168.1.20:9000/api/kestrel/info': async () => ({ status: 200, body: { name: 'Kestrel', ha_name: 'Lab' } }),
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

test('sync, section saves, settings and room go to the component', async () => {
  const url = 'http://homeassistant.local'
  const store = memStore({ 'kestrel.pairing': JSON.stringify({ token: 'tok', urls: [url] }) })
  const fetch = fakeFetch({
    [`GET ${url}/api/kestrel/sync`]: async () => ({ status: 200, body: { targets: [], paints: {}, paints_rev: 2 } }),
    [`GET ${url}/api/kestrel/sync?only=paints`]: async () => ({ status: 200, body: { paints: {}, paints_rev: 2 } }),
    [`GET ${url}/api/kestrel/sync?have=targets:abc,paints:2`]: async () => ({ status: 200, body: { paints_rev: 2 } }),
    [`POST ${url}/api/kestrel/paints`]: async (r) => {
      assert.deepEqual(JSON.parse(r.body), { paints: { 'light.a': [] } })
      return { status: 200, body: { ok: true, rev: 3 } }
    },
    [`POST ${url}/api/kestrel/settings`]: async (r) => {
      assert.deepEqual(JSON.parse(r.body), { settings: { dwell: { enabled: true } } })
      return { status: 200, body: { ok: true, rev: 4, settings: { dwell: { enabled: true, seconds: 3 } } } }
    },
    [`GET ${url}/api/kestrel/room?here=kitchen`]: async () => ({ status: 200, body: { room: null } }),
    [`GET ${url}/api/kestrel/room`]: async () => ({ status: 200, body: { room: { id: 'office', name: 'Office' } } }),
  })
  const ha = new HaClient({ fetch, store })
  assert.equal((await ha.sync()).paints_rev, 2)
  assert.deepEqual(await ha.sync(['paints']), { paints: {}, paints_rev: 2 })
  assert.deepEqual(await ha.sync(null, { targets: 'abc', paints: 2 }), { paints_rev: 2 })
  assert.deepEqual(await ha.saveSection('paints', { 'light.a': [] }), { ok: true, rev: 3 })
  assert.equal((await ha.saveSettings({ dwell: { enabled: true } })).settings.dwell.seconds, 3)
  assert.deepEqual(await ha.room(), { id: 'office', name: 'Office' })
  assert.equal(await ha.room('kitchen'), null) // reports where the watch is
})

test('painting next to another device says which one crowds it', () => {
  const near = [{ heading: 288, headingSpread: 10, pitch: 22, pitchSpread: 1 }]
  const far = [{ heading: 100, headingSpread: 5, pitch: 20, pitchSpread: 1 }]
  const c = crowdedBy({ 'light.near': near, 'light.far': far }, 'light.island', island.spots[0])
  assert.equal(c.id, 'light.near')
  assert.equal(c.headingGap, 10)
  // the chandelier, 18° away, stands clear now that wide spots don't claim the space between
  assert.equal(crowdedBy({ 'light.chandelier': chandelier.spots, 'light.far': far }, 'light.island', island.spots[0]), null)
  assert.equal(crowdedBy({ 'light.near': near }, 'light.island', null), null)
})
