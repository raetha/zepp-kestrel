import { test } from 'node:test'
import assert from 'node:assert/strict'

import { wrap360, angleDiff, circularMean } from '../lib/circular.js'
import { percentile, summarize } from '../lib/stats.js'
import { RateMeter } from '../lib/rate.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

test('wrap360 and angleDiff', () => {
  assert.equal(wrap360(-10), 350)
  assert.equal(wrap360(725), 5)
  assert.equal(angleDiff(1, 359), 2)
  assert.equal(angleDiff(359, 1), -2)
  assert.equal(angleDiff(180, 0), 180)
})

test('circularMean averages across north', () => {
  const m = circularMean([359, 1])
  near(angleDiff(m.mean, 0), 0)
  assert.ok(m.r > 0.99)
  assert.ok(m.spread < 2)
})

test('circularMean respects weights and reports spread', () => {
  near(circularMean([10, 20], [3, 1]).mean, 12.5, 0.2)
  assert.ok(circularMean([0, 60, 120]).spread > circularMean([0, 10, 20]).spread)
  assert.equal(circularMean([]), null)
  assert.equal(circularMean([0, 180]), null)
})

test('percentile and summarize', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(percentile([10, 20], 0.5), 15)
  assert.deepEqual(summarize([1, 2, 3]), { n: 3, min: 1, p50: 2, p90: 2.8, max: 3 })
  assert.deepEqual(summarize([]), { n: 0 })
})

test('RateMeter counts calls and distinct readings', () => {
  const m = new RateMeter()
  for (let i = 0; i < 50; i++) m.tick(i * 20, { x: Math.floor(i / 2) })
  const r = m.report(1000)
  assert.equal(r.calls, 50)
  assert.equal(r.hz, 50)
  assert.equal(r.distinctHz, 25)
  assert.equal(r.intervalMs.p50, 20)
})
