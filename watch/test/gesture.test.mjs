import { test } from 'node:test'
import assert from 'node:assert/strict'

import { peakRate, peakJolt, calibrateGesture, GestureDetector, candidateAt, LIMITS } from '../lib/gesture.js'

// readings at 25 Hz (40 ms apart) from t0
const gyroFeed = (det, t0, rates) => rates.map((r, i) => det.gyroUpdate(t0 + i * 40, r))
const accelFeed = (det, t0, zs) => zs.map((z, i) => det.accelUpdate(t0 + i * 40, { x: 0, y: 0, z }))

test('peaks', () => {
  assert.equal(peakRate([]), 0)
  assert.equal(peakRate([{ x: 3, y: 4, z: 0 }, { x: 0, y: 0, z: 2 }]), 5)
  assert.equal(peakJolt([{ x: 0, y: 0, z: 1000 }]), 0)
  assert.equal(peakJolt([{ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 1300 }, { x: 0, y: 0, z: 1250 }]), 300)
})

test('gyro channel: a flick fires once; swings, small movement and repeats do not', () => {
  const det = new GestureDetector({ gyro: 600 })
  assert.deepEqual(gyroFeed(det, 0, [5, 3, 250, 1521, 900, 200, 10]), [false, false, false, true, false, false, false])
  assert.equal(det.startedAt, 80)
  assert.deepEqual(gyroFeed(det, 300, [700, 10]), [false, false]) // settling, inside the refractory time
  assert.ok(!gyroFeed(det, 3000, [139, 273, 88, 49, 3]).includes(true))
  assert.ok(!gyroFeed(det, 6000, [200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 650, 10]).includes(true))
  assert.deepEqual(gyroFeed(det, 9000, [5, 400, 1200, 5]), [false, false, true, false])
})

test('jolt channel: a snap fires, still or slowly moving arm does not', () => {
  const det = new GestureDetector({ gyro: null, jolt: 150 })
  assert.ok(!gyroFeed(det, 0, [2000]).includes(true)) // gyro channel off
  assert.ok(!accelFeed(det, 0, [1000, 1010, 1005, 1020, 1030, 1040]).includes(true)) // drift
  assert.deepEqual(accelFeed(det, 1000, [1000, 1000, 1300, 1000, 1000]), [false, false, true, false, false])
  assert.equal(det.startedAt, 1080)
})

test('calibration: thresholds per channel, only where the gesture stands out', () => {
  // a flick: big on the gyro, the jolt overlaps movement
  const flick = calibrateGesture(
    [{ gyro: 1400, jolt: 300 }, { gyro: 1521, jolt: 250 }, { gyro: 900, jolt: 200 }, { gyro: 1100, jolt: 280 }],
    { gyro: 150, jolt: 260 },
  )
  assert.equal(flick.ok, true)
  assert.equal(flick.gyro, Math.round(Math.sqrt(1100 * 150)))
  assert.equal(flick.jolt, null)
  // a snap while aiming: the jolt separates, the gyro barely
  const snap = calibrateGesture(
    [{ gyro: 120, jolt: 500 }, { gyro: 90, jolt: 877 }, { gyro: 100, jolt: 400 }],
    { gyro: 80, jolt: 60 },
  )
  assert.equal(snap.gyro, null)
  assert.equal(snap.jolt, Math.round(Math.sqrt(500 * 60)))
  assert.deepEqual(calibrateGesture([{ gyro: 900 }], { gyro: 100 }), { ok: false, gyro: null, jolt: null, reason: 'too few gestures' })
  const none = calibrateGesture([{ gyro: 100, jolt: 50 }, { gyro: 110, jolt: 55 }, { gyro: 120, jolt: 60 }], { gyro: 100, jolt: 50 })
  assert.equal(none.ok, false)
  assert.match(none.reason, /too close/)
  assert.equal(calibrateGesture([{ gyro: 9000 }, { gyro: 9000 }, { gyro: 9000 }], { gyro: 5000 }).gyro, LIMITS.gyro.max)
  assert.equal(calibrateGesture([{ gyro: 50 }, { gyro: 50 }, { gyro: 50 }], { gyro: 2 }).gyro, LIMITS.gyro.min)
  assert.equal(calibrateGesture([{ gyro: 500 }, { gyro: 600 }, { gyro: 700 }], null).gyro, LIMITS.gyro.min)
})

test('candidateAt finds the device in mind just before the gesture', () => {
  const history = [
    { t: 100, id: 'light.a' },
    { t: 500, id: 'light.b' },
    { t: 900, id: 'light.c' },
  ]
  assert.equal(candidateAt(history, 950), 'light.c')
  assert.equal(candidateAt(history, 800), 'light.b')
  assert.equal(candidateAt(history, 2000), null)
  assert.equal(candidateAt([], 100), null)
  assert.equal(candidateAt(history, 50), null)
})

test('dimming: a quarter turn is the whole range, thumb up brightens', async () => {
  const { dimStep } = await import('../lib/dim.js')
  assert.equal(dimStep(0, 0), 0)
  assert.equal(dimStep(0, -45), 50) // thumb halfway up
  assert.equal(dimStep(10, 55), -50) // thumb down
  assert.equal(dimStep(0, -170), 100) // clamped
  assert.equal(dimStep(0, -2), 0) // under half a step
  assert.equal(dimStep(170, -170), -20) // across the ±180 seam: 20 degrees thumb-down
})
