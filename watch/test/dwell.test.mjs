import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Dwell } from '../lib/dwell.js'

// feed a locked id every 100 ms from t0 to t1 (exclusive); return the fires
function run(d, t0, t1, id) {
  const fires = []
  for (let t = t0; t < t1; t += 100) {
    const r = d.update(t, id)
    if (r.fire) fires.push([t, r.fire])
  }
  return fires
}

test('fires once after holding the lock for the dwell time', () => {
  const d = new Dwell({ ms: 3000 })
  assert.deepEqual(run(d, 0, 2900, 'light.a'), [])
  assert.deepEqual(run(d, 2900, 3100, 'light.a'), [[3000, 'light.a']])
  // still holding: no repeat
  assert.deepEqual(run(d, 3100, 10000, 'light.a'), [])
})

test('progress counts up and a brief flicker does not restart it', () => {
  const d = new Dwell({ ms: 2000 })
  run(d, 0, 1000, 'light.a')
  assert.equal(d.update(1000, null).progress, 0.5) // flicker: still counting
  assert.deepEqual(run(d, 1100, 2100, 'light.a'), [[2000, 'light.a']])
})

test('moving to another device or away restarts the count', () => {
  const d = new Dwell({ ms: 2000 })
  run(d, 0, 1500, 'light.a')
  run(d, 1500, 2000, null) // away longer than the grace
  assert.deepEqual(run(d, 2000, 3900, 'light.a'), [])
  assert.deepEqual(run(d, 3900, 4100, 'light.a'), [[4000, 'light.a']])
  const e = new Dwell({ ms: 2000 })
  run(e, 0, 1500, 'light.a')
  assert.deepEqual(run(e, 1500, 3400, 'light.b'), [])
  assert.deepEqual(run(e, 3400, 3600, 'light.b'), [[3500, 'light.b']])
})

test('the same device fires again only after looking away', () => {
  const d = new Dwell({ ms: 1000, rearmMs: 1000 })
  assert.deepEqual(run(d, 0, 1100, 'light.a'), [[1000, 'light.a']])
  run(d, 1100, 1600, null) // away, but not long enough
  assert.deepEqual(run(d, 1600, 3000, 'light.a'), [])
  run(d, 3000, 4200, null) // away long enough
  assert.deepEqual(run(d, 4200, 5300, 'light.a'), [[5200, 'light.a']])
})

test('a button or gesture trigger counts as the trigger for that device', () => {
  const d = new Dwell({ ms: 1000 })
  run(d, 0, 500, 'light.a')
  d.triggered('light.a')
  assert.deepEqual(run(d, 500, 3000, 'light.a'), [])
})
