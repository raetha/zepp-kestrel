import { test } from 'node:test'
import assert from 'node:assert/strict'

import { peakRate, calibrateFlick, FlickDetector, candidateAt, THRESHOLD_MIN, THRESHOLD_MAX } from '../lib/flick.js'

// gyro magnitudes at 25 Hz (40 ms apart) starting at t0
const feed = (det, t0, rates) => rates.map((r, i) => det.update(t0 + i * 40, r))

test('peakRate', () => {
  assert.equal(peakRate([]), 0)
  assert.equal(peakRate([{ x: 3, y: 4, z: 0 }, { x: 0, y: 0, z: 2 }]), 5)
})

test('a flick fires once; slow swings, small movement and repeats do not', () => {
  const det = new FlickDetector({ threshold: 600 })
  // real flick shape: quiet, sharp rise, quiet
  assert.deepEqual(feed(det, 0, [5, 3, 250, 1521, 900, 200, 10]), [false, false, false, true, false, false, false])
  // arm settling right after: within the refractory period
  assert.deepEqual(feed(det, 300, [700, 10]), [false, false])
  // ordinary movement never reaches the threshold
  assert.ok(!feed(det, 3000, [139, 273, 88, 49, 3]).includes(true))
  // a slow swing: above the low mark for longer than maxBurstMs before peaking
  assert.ok(!feed(det, 6000, [200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 650, 10]).includes(true))
  // the next flick, well after: fires, and startedAt is the start of its burst
  assert.deepEqual(feed(det, 9000, [5, 400, 1200, 5]), [false, false, true, false])
  assert.equal(det.startedAt, null) // burst over
})

test('startedAt marks where the burst began', () => {
  const det = new FlickDetector({ threshold: 600 })
  feed(det, 1000, [5, 300, 500])
  assert.equal(det.startedAt, 1040)
  assert.equal(det.update(1120, 1000), true)
  assert.equal(det.startedAt, 1040)
})

test('calibration picks a threshold between movement and flicks', () => {
  const c = calibrateFlick([1400, 1521, 900, 1100, 1300], 273)
  assert.equal(c.ok, true)
  assert.ok(c.threshold > 273 && c.threshold < 1100, String(c.threshold))
  assert.equal(c.threshold, Math.round(Math.sqrt(1100 * 273)))
  assert.deepEqual(calibrateFlick([900, 1000], 100), { ok: false, threshold: null, reason: 'too few flicks' })
  assert.equal(calibrateFlick([300, 310, 320], 280).reason, 'flicks too close to ordinary movement')
  assert.equal(calibrateFlick([5000, 6000, 7000], 4000).threshold, THRESHOLD_MAX)
  assert.equal(calibrateFlick([100, 120, 130], 2).threshold, THRESHOLD_MIN)
})

test('candidateAt finds the device in mind just before the flick', () => {
  const history = [
    { t: 100, id: 'light.a' },
    { t: 500, id: 'light.b' },
    { t: 900, id: 'light.c' },
  ]
  assert.equal(candidateAt(history, 950), 'light.c')
  assert.equal(candidateAt(history, 800), 'light.b') // the burst started before c was in mind
  assert.equal(candidateAt(history, 2000), null) // too long ago
  assert.equal(candidateAt([], 100), null)
  assert.equal(candidateAt(history, 50), null)
})
