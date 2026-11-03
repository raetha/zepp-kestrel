import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeSection, markDirty } from '../lib/sync.js'

test('nothing changed anywhere: keep, no push', () => {
  assert.deepEqual(mergeSection({ a: 1 }, 3, [], { a: 1 }, 3), { value: { a: 1 }, push: false })
})

test('changed on the watch only: keep and push', () => {
  assert.deepEqual(mergeSection({ a: 1, b: 2 }, 3, ['b'], { a: 1 }, 3), { value: { a: 1, b: 2 }, push: true })
})

test('changed in Home Assistant only: take its copy', () => {
  // a bad paint removed in the options
  assert.deepEqual(mergeSection({ a: 1, b: 2 }, 3, [], { a: 1 }, 4), { value: { a: 1 }, push: false })
})

test('changed on both: Home Assistant copy plus the watch changes, pushed', () => {
  const r = mergeSection({ a: 1, b: 9, c: 3 }, 3, ['b', 'd'], { a: 5, b: 2 }, 5)
  assert.deepEqual(r, { value: { a: 5, b: 9 }, push: true }) // d was deleted on the watch, c deleted in HA
  assert.deepEqual(mergeSection(null, 0, null, null, 1), { value: {}, push: false })
})

test('markDirty adds once', () => {
  assert.deepEqual(markDirty(undefined, 'a'), ['a'])
  assert.deepEqual(markDirty(['a'], 'a'), ['a'])
})
