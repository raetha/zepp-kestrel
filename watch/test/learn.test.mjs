import { test } from 'node:test'
import assert from 'node:assert/strict'
import { learnSpot, adaptFingerprint, clearMatch, LEARN } from '../lib/learn.js'

const lamp = [{ heading: 90, headingSpread: 5, pitch: 10, pitchSpread: 2, room: 'den' }]

test('a first vote starts a learned spot; later ones move it, ever more slowly', () => {
  let paints = { 'light.lamp': lamp }
  let spots = learnSpot(paints, 'light.lamp', { heading: 96, pitch: 12 }, 'den', LEARN, 1)
  assert.equal(spots.length, 2)
  const l = spots[1]
  assert.equal(l.kind, 'learned')
  assert.equal(l.room, 'den')
  assert.equal(l.heading, 96)
  assert.deepEqual(spots[0], lamp[0]) // the painted spot is never changed
  paints = { 'light.lamp': spots }
  spots = learnSpot(paints, 'light.lamp', { heading: 100, pitch: 12 }, 'den', LEARN, 2)
  assert.equal(spots.length, 2)
  assert.equal(spots[1].uses, 2)
  assert.ok(spots[1].heading > 96 && spots[1].heading < 100)
  // after many votes, one far-ish vote barely moves it
  let s = { ...spots[1], uses: 50 }
  const moved = learnSpot({ 'light.lamp': [lamp[0], s] }, 'light.lamp', { heading: s.heading + 7, pitch: 12 }, 'den')[1]
  assert.ok(Math.abs(moved.heading - s.heading) <= 7 / LEARN.maxVotes + 0.1)
})

test('learned spots wrap around north', () => {
  const north = [{ heading: 359, headingSpread: 4, pitch: 0, pitchSpread: 2, kind: 'learned', uses: 1 }]
  const s = learnSpot({ x: north }, 'x', { heading: 3, pitch: 0 })[0]
  assert.ok(s.heading >= 359 || s.heading <= 3)
})

test('a vote that would crowd another device is not kept, and votes need a usable aim', () => {
  const paints = { 'light.lamp': lamp, 'light.tv': [{ heading: 104, headingSpread: 4, pitch: 10, pitchSpread: 2 }] }
  assert.equal(learnSpot(paints, 'light.lamp', { heading: 101, pitch: 10 }, 'den'), null)
  assert.equal(learnSpot(paints, 'light.lamp', { heading: null, pitch: 10 }), null)
  assert.equal(learnSpot(paints, 'light.lamp', null), null)
})

test('at most a few learned spots: the least used goes', () => {
  let spots = [...lamp]
  for (const [h, uses] of [[60, 5], [120, 1], [150, 3]]) spots.push({ heading: h, headingSpread: 6, pitch: 10, pitchSpread: 4, kind: 'learned', uses, room: 'den' })
  const next = learnSpot({ 'light.lamp': spots }, 'light.lamp', { heading: 200, pitch: 10 }, 'den')
  const learned = next.filter((s) => s.kind === 'learned')
  assert.equal(learned.length, LEARN.maxLearned)
  assert.ok(!learned.some((s) => s.heading === 120))
})

test('rooms learn only from clear matches', () => {
  assert.equal(clearMatch([{ id: 'a', score: 0.9 }, { id: 'b', score: 0.4 }]), true)
  assert.equal(clearMatch([{ id: 'a', score: 0.9 }, { id: 'b', score: 0.7 }]), false)
  assert.equal(clearMatch([{ id: 'a', score: 0.3 }]), false)
  assert.equal(clearMatch([]), false)
})

test('a fingerprint drifts towards what is heard; silent devices fade, new ones fade in', () => {
  const fp = { A: [-70, 1], B: [-80, 0.21], C: [-60, 1] }
  const next = adaptFingerprint(fp, [{ mac: 'A', rssi: -60 }, { mac: 'C', rssi: -60 }, { mac: 'D', rssi: -75 }, { mac: 'E', rssi: -99 }])
  assert.deepEqual(next.A, [-69, 1])
  assert.equal(next.B, undefined) // 0.21 * 0.9 < 0.2
  assert.deepEqual(next.D, [-75, 0.1])
  assert.equal(next.E, undefined) // too weak to start
  assert.deepEqual(Object.keys(next), ['C', 'A', 'D']) // strongest first
})
