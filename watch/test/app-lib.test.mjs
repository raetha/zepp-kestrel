import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pitchRoll, AimGate } from '../lib/aim.js'
import { analyzeSpike } from '../lib/spike.js'
import { macToString, looksRotating, ScanAggregator } from '../lib/ble.js'
import { Dedupe } from '../lib/protocol.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

test('pitchRoll: flat, raised, rolled', () => {
  const g = 981
  const flat = pitchRoll(0, 0, g)
  near(flat.pitch, 0)
  near(flat.roll, 0)
  near(pitchRoll(0, g, 0).pitch, 90)
  near(pitchRoll(0, -g, 0).pitch, -90)
  near(Math.abs(pitchRoll(0, 0, -g).roll), 180)
})

test('AimGate needs stillness, sane pitch and calibration', () => {
  const gate = new AimGate()
  assert.equal(gate.update(0, 5, 10, true), false) // not still long enough
  assert.equal(gate.update(350, 5, 10, true), true)
  assert.equal(gate.update(360, 80, 10, true), false) // moved
  assert.equal(gate.update(700, 5, 10, true), false) // stillness restarted at 700
  assert.equal(gate.update(1100, 5, 85, true), false) // pointing at the ceiling
  assert.equal(gate.update(1200, 5, 10, false), false) // compass not calibrated
  assert.equal(gate.update(1300, 5, 10, true), true)
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
