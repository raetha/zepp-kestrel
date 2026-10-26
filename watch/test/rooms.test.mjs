import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFingerprint, scoreRoom, rankRooms, pickRoom, spotsForRoom, soundsLike, OTHER_ROOM_PRIOR } from '../lib/rooms.js'

const scan = (pairs) => pairs.map(([mac, rssi]) => ({ mac, rssi }))

test('a fingerprint keeps steady devices with their average signal', () => {
  const fp = buildFingerprint([
    scan([['A', -60], ['B', -70], ['X', -90]]),
    scan([['A', -62], ['B', -74]]),
    scan([['A', -58], ['C', -80]]),
  ])
  assert.deepEqual(fp, { A: [-60, 1], B: [-72, 0.67] }) // X and C heard once in three: dropped
  assert.deepEqual(buildFingerprint([]), {})
  assert.deepEqual(buildFingerprint([scan([['A', -60]])]), { A: [-60, 1] }) // one scan keeps everything
})

test('scans match their own room and not another', () => {
  const rooms = {
    office: { name: 'Office', fingerprint: { A: [-60, 1], B: [-70, 1], C: [-80, 0.5] } },
    kitchen: { name: 'Kitchen', fingerprint: { D: [-55, 1], E: [-65, 1] } },
  }
  const inOffice = scan([['A', -63], ['B', -68], ['D', -92]])
  const ranked = rankRooms(rooms, inOffice)
  assert.equal(ranked[0].id, 'office')
  assert.ok(ranked[0].score > 0.6, String(ranked[0].score))
  assert.ok(ranked[1].score < 0.1)
  assert.deepEqual(pickRoom(ranked), { id: 'office', name: 'Office', score: ranked[0].score === 1 ? 1 : Math.round(ranked[0].score * 100) / 100 })

  // strong strangers count against a room
  const elsewhere = scan([['A', -63], ['Z1', -50], ['Z2', -55], ['Z3', -60]])
  assert.ok(scoreRoom(rooms.office.fingerprint, elsewhere) < scoreRoom(rooms.office.fingerprint, scan([['A', -63]])))
  assert.equal(scoreRoom({}, inOffice), 0)
  assert.deepEqual(rankRooms(undefined, inOffice), [])
})

test('no clear winner, no room', () => {
  assert.equal(pickRoom([]), null)
  assert.equal(pickRoom([{ id: 'a', name: 'A', score: 0.2 }]), null)
  assert.equal(pickRoom([{ id: 'a', name: 'A', score: 0.6 }, { id: 'b', name: 'B', score: 0.55 }]), null)
  assert.equal(pickRoom([{ id: 'a', name: 'A', score: 0.6 }, { id: 'b', name: 'B', score: 0.2 }]).id, 'a')
})

test('spots count fully in their own room and untagged ones everywhere; other rooms count less', () => {
  const spots = [{ heading: 1, room: 'office' }, { heading: 2, room: 'kitchen' }, { heading: 3 }]
  const inOffice = spotsForRoom(spots, 'office')
  assert.deepEqual(inOffice.map((s) => s.heading), [1, 2, 3])
  assert.deepEqual(inOffice.map((s) => s.prior), [undefined, OTHER_ROOM_PRIOR, undefined])
  assert.equal(spots[1].prior, undefined) // the stored spot is left alone
  assert.equal(spotsForRoom(spots, null), spots)
})

test('rooms sharing a space sound alike; separate ones do not', () => {
  // an open-plan kitchen and dining room, calibrated on a real watch (addresses replaced)
  const rooms = {
    dining: { name: 'Dining', fingerprint: { A: [-67, 1], B: [-80, 0.67], C: [-81, 1], D: [-85, 1], E: [-86, 1], F: [-98, 0.67] } },
    kitchen: { name: 'Kitchen', fingerprint: { A: [-76, 1], C: [-85, 1], D: [-88, 1], E: [-92, 0.67], G: [-93, 1], H: [-94, 1], B: [-98, 0.67], F: [-98, 0.67] } },
    office: { name: 'Office', fingerprint: { X: [-60, 1], Y: [-70, 1], D: [-95, 0.67] } },
  }
  assert.equal(soundsLike(rooms, 'kitchen').id, 'dining')
  assert.equal(soundsLike(rooms, 'dining').id, 'kitchen')
  assert.equal(soundsLike(rooms, 'office'), null)
  assert.equal(soundsLike(rooms, 'garage'), null)
})

test('sure of the room: spots from other rooms are left out', () => {
  const spots = [{ heading: 1, room: 'office' }, { heading: 2, room: 'kitchen' }, { heading: 3 }]
  assert.deepEqual(spotsForRoom(spots, 'office', 0).map((s) => s.heading), [1, 3])
})
