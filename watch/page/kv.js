// The watch's storage: one small JSON file per key, in the app's data folder.
//
// Not LocalStorage: each page gets its own copy of LocalStorage and only
// writes it back when that page closes. The home page stays open under every
// other page, so what its sync saved (areas, targets) didn't reach Paint or
// Rooms, and the app context's copy wiped page writes when the app closed.
// Files are written at once and read fresh by every page.
//
// Values saved by earlier builds in LocalStorage are read once as a fallback,
// so paints and settings carry over.

import { readFileSync, writeFileSync } from '@zos/fs'
import { LocalStorage } from '@zos/storage'

let legacy = null

const file = (key) => `${key}.json`

function readLegacy(key) {
  try {
    legacy = legacy || new LocalStorage()
    const v = legacy.getItem(key)
    return v === undefined || v === null || v === '' ? undefined : JSON.parse(v)
  } catch (e) {
    return undefined
  }
}

export function get(key, fallback) {
  try {
    const s = readFileSync({ path: file(key), options: { encoding: 'utf8' } })
    if (typeof s === 'string' && s !== '') return JSON.parse(s)
  } catch (e) {
    // no file yet, or unreadable: fall through
  }
  const old = readLegacy(key)
  return old === undefined ? fallback : old
}

export function set(key, value) {
  writeFileSync({ path: file(key), data: JSON.stringify(value), options: { encoding: 'utf8' } })
}
