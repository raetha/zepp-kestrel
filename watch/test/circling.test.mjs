import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Circling } from '../lib/circling.js'

test('level watch lights nothing', () => {
  const c = new Circling()
  assert.equal(c.add(2, -3), -1)
  assert.equal(c.count, 0)
})

test('a full circle of tilt lights every tick once', () => {
  const c = new Circling({ ticks: 12 })
  const lit = []
  for (let a = 0; a < 360; a += 10) {
    const i = c.add(30 * Math.cos((a * Math.PI) / 180), 30 * Math.sin((a * Math.PI) / 180))
    if (i >= 0) lit.push(i)
  }
  assert.equal(c.count, 12)
  assert.equal(new Set(lit).size, 12)
  assert.equal(c.fraction, 1)
  c.reset()
  assert.equal(c.count, 0)
})

test('leaning one way again lights nothing new', () => {
  const c = new Circling()
  assert.ok(c.add(40, 0) >= 0)
  assert.equal(c.add(45, 1), -1)
  assert.equal(c.add(NaN, 1), -1)
})
