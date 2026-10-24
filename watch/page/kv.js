// The watch's storage: one small JSON file per key, in the app's data folder.
//
// Not LocalStorage: each page (and the app context) gets its own copy of
// LocalStorage and writes it back later, so what Home's sync saved (areas,
// targets) didn't reach Paint or Rooms, and the app context's copy wiped page
// writes when the app closed. Files are written at once and read fresh by
// every page.

import { readFileSync, writeFileSync } from '@zos/fs'

const file = (key) => `${key}.json`

export function get(key, fallback) {
  try {
    const s = readFileSync({ path: file(key), options: { encoding: 'utf8' } })
    if (typeof s === 'string' && s !== '') return JSON.parse(s)
  } catch (e) {
    // no file yet, or unreadable
  }
  return fallback
}

export function set(key, value) {
  writeFileSync({ path: file(key), data: JSON.stringify(value), options: { encoding: 'utf8' } })
}
