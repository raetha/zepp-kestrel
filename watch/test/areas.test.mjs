import { test } from 'node:test'
import assert from 'node:assert/strict'

import { targetsInArea, areaChoices, ALL, NONE } from '../lib/areas.js'

const targets = [
  { id: 'light.a', area_id: 'kitchen', area: 'Kitchen' },
  { id: 'light.b', area_id: 'kitchen', area: 'Kitchen' },
  { id: 'light.c', area_id: 'office', area: 'Office' },
  { id: 'switch.d', area: 'Office' }, // from an older sync: name only
  { id: 'fan.e' },
]
const areas = [
  { id: 'bath', name: 'Bathroom' },
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'office', name: 'Office' },
]

test('targets in an area, by id or (older syncs) by name', () => {
  assert.deepEqual(targetsInArea(targets, { id: 'kitchen', name: 'Kitchen' }).map((t) => t.id), ['light.a', 'light.b'])
  assert.deepEqual(targetsInArea(targets, { id: 'office', name: 'Office' }).map((t) => t.id), ['light.c', 'switch.d'])
  assert.deepEqual(targetsInArea(targets, NONE).map((t) => t.id), ['fan.e'])
  assert.equal(targetsInArea(targets, ALL).length, 5)
  assert.equal(targetsInArea(targets, null).length, 5)
})

test('area choices skip empty areas and end with No area and All devices', () => {
  assert.deepEqual(
    areaChoices(targets, areas).map((a) => `${a.name} ${a.count}`),
    ['Kitchen 2', 'Office 2', 'No area 1', 'All devices 5'],
  )
  assert.deepEqual(areaChoices([{ id: 'x', area_id: 'kitchen' }], undefined).map((a) => a.id), [ALL.id])
})

test('scenes, scripts and buttons get their own choice, first', async () => {
  const { ACTIONS } = await import('../lib/areas.js')
  const list = [...targets, { id: 'scene.movie', area_id: 'kitchen' }, { id: 'script.night' }, { id: 'input_button.bell' }]
  const choices = areaChoices(list, [{ id: 'kitchen', name: 'Kitchen' }])
  assert.equal(choices[0].id, ACTIONS.id)
  assert.equal(choices[0].count, 3)
  assert.deepEqual(targetsInArea(list, ACTIONS).map((t) => t.id), ['scene.movie', 'script.night', 'input_button.bell'])
})
