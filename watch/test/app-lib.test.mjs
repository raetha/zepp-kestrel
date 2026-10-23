import { test } from 'node:test'
import assert from 'node:assert/strict'

import { attitude, AimGate } from '../lib/aim.js'
import { analyzeSpike } from '../lib/spike.js'
import { macToString, looksRotating, ScanAggregator } from '../lib/ble.js'
import { Dedupe } from '../lib/protocol.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

// Device axes as world vectors (east, north, up) for a forearm with this
// heading, elevation and roll (right wrist: the hand is toward -x).
function pose(headingDeg, pitchDeg, rollDeg) {
  const r = Math.PI / 180
  const h = headingDeg * r
  const p = pitchDeg * r
  const q = rollDeg * r
  const f = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)] // hand direction
  const up = [-Math.sin(h) * Math.sin(p), -Math.cos(h) * Math.sin(p), Math.cos(p)] // perpendicular to f, upward
  const right = [Math.cos(h), -Math.sin(h), 0] // horizontal, to the right of the forearm
  // Right wrist, palm down: 9 o'clock toward the hand, so 12 o'clock points to
  // the right of the forearm and the screen faces up. Roll turns both about the forearm.
  const y = right.map((v, i) => v * Math.cos(q) + up[i] * Math.sin(q))
  const z = up.map((v, i) => v * Math.cos(q) - right[i] * Math.sin(q))
  const x = f.map((v) => -v)
  return { x, y, z }
}

// What the sensors would read in that pose: gravity reaction (world up) in
// device axes, and the compass angle of 12 o'clock.
function read({ x, y, z }) {
  const g = 981
  const heading12 = ((Math.atan2(y[0], y[1]) * 180) / Math.PI + 360) % 360
  return { ax: x[2] * g, ay: y[2] * g, az: z[2] * g, heading12 }
}

const angleNear = (a, b, eps = 1e-6) => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180)
  assert.ok(d < eps, `${a} !~ ${b}`)
}

test('attitude: flat, raised, palm up', () => {
  const g = 981
  const flat = attitude(0, 0, g, 100)
  near(flat.pitch, 0)
  near(flat.roll, 0)
  angleNear(flat.heading, 10) // the hand is 90 degrees counterclockwise of 12 o'clock
  // right wrist, hand raised 30 degrees: +x (toward the elbow) dips, so gravity's reaction has -x
  near(attitude(-g / 2, 0, (g * Math.sqrt(3)) / 2).pitch, 30)
  // palm up: 12 o'clock now points the other way; the forearm heading stays put
  const up = attitude(0, 0, -g, 280)
  near(Math.abs(up.roll), 180)
  angleNear(up.heading, 10)
  assert.equal(attitude(0, 0, g).heading, null)
  assert.equal(attitude(0, 0, 0), null)
})

test('attitude recovers the forearm heading across pitch and roll', () => {
  for (const heading of [0, 37, 145, 260, 359]) {
    for (const pitch of [-45, -10, 0, 25, 60]) {
      for (const roll of [-45, -20, 0, 15, 40]) {
        const { ax, ay, az, heading12 } = read(pose(heading, pitch, roll))
        const a = attitude(ax, ay, az, heading12)
        angleNear(a.heading, heading, 1e-6)
        near(a.pitch, pitch, 1e-6)
        near(a.roll, roll, 1e-6)
      }
    }
  }
})

test('AimGate needs stillness, a sane pose and calibration', () => {
  const gate = new AimGate()
  assert.equal(gate.update(0, 5, 10, 0, true), false) // not still long enough
  assert.equal(gate.update(350, 5, 10, 0, true), true)
  assert.equal(gate.update(360, 80, 10, 0, true), false) // moved
  assert.equal(gate.update(700, 5, 10, 0, true), false) // stillness restarted at 700
  assert.equal(gate.update(1100, 5, 85, 0, true), false) // pointing at the ceiling
  assert.equal(gate.update(1110, 5, -75, 0, true), false) // or the floor
  assert.equal(gate.update(1150, 5, 10, 80, true), false) // thumb up: compass heading unreliable
  assert.equal(gate.update(1200, 5, 10, 0, false), false) // compass not calibrated
  assert.equal(gate.update(1300, 5, 10, -30, true), true)
})

test('analyzeSpike finds a short spike in a quiet window', () => {
  const s = []
  for (let i = 0; i < 100; i++) {
    const t = i * 10 // 100 Hz
    const bump = i >= 50 && i <= 52 ? 1500 : 0
    s.push({ t, x: 0, y: 0, z: 981 + bump })
  }
  const r = analyzeSpike(s)
  assert.equal(r.n, 100)
  assert.equal(r.hz, 100)
  assert.equal(r.peakDev, 1500)
  assert.equal(r.widthMs, 20)
  assert.ok(r.peakT === 500 || r.peakT === 530)
})

test('analyzeSpike tolerates tiny input', () => {
  assert.equal(analyzeSpike([]).n, 0)
})

test('BLE helpers', () => {
  assert.equal(macToString(new Uint8Array([0xa4, 0xc1, 0x38, 0x01, 0x02, 0x0f])), 'A4:C1:38:01:02:0F')
  assert.equal(macToString(new Uint8Array([1, 2]).buffer), '01:02')
  assert.equal(looksRotating('5A:00:00:00:00:00'), true)
  assert.equal(looksRotating('A4:C1:38:01:02:0F'), false)

  const agg = new ScanAggregator()
  const lamp = new Uint8Array([0xa4, 0xc1, 0x38, 0, 0, 1])
  agg.add({ dev_addr: lamp.buffer, dev_name: '', rssi: -60 })
  agg.add({ dev_addr: lamp.buffer, dev_name: 'plug', rssi: -70 })
  agg.add({ dev_addr: lamp.buffer, dev_name: '', rssi: -65 })
  agg.add({ dev_addr: new Uint8Array([0x5a, 1, 2, 3, 4, 5]).buffer, dev_name: 'phone', rssi: -40 })
  const sum = agg.summary()
  assert.equal(agg.size, 2)
  assert.deepEqual(sum, [{ mac: 'A4:C1:38:00:00:01', name: 'plug', rssi: -65, hits: 3 }])
  assert.equal(agg.summary({ includeRotating: true })[0].name, 'phone')
})

test('Dedupe drops repeats and forgets old entries', () => {
  const d = new Dedupe(2)
  assert.equal(d.accept(1), true)
  assert.equal(d.accept(1), false)
  d.accept(2)
  d.accept(3)
  assert.equal(d.accept(1), true)
})
