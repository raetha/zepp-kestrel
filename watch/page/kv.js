// The watch's storage: one small JSON file per key, in the app's data folder.
//
// Not LocalStorage: each page (and the app context) gets its own copy of
// LocalStorage and writes it back later, so what Home's sync saved (areas,
// targets) didn't reach Paint or Rooms, and the app context's copy wiped page
// writes when the app closed. Files are written at once and read fresh by
// every page.
//
// Each page has its own copy of this module, and only one page runs at a
// time, so a file read once stays valid in memory until this page writes it:
// flash is read once per key per page, not on every call (a sync calls
// syncMeta() a dozen times; the device list can be 60 kB). Callers get a
// fresh parse each time, so changing a returned object never changes the cache.

import { readFileSync, writeFileSync } from '@zos/fs'

const file = (key) => `${key}.json`
const cache = new Map() // key -> file text ('' = no file)

function text(key) {
  if (cache.has(key)) return cache.get(key)
  let s = ''
  try {
    const r = readFileSync({ path: file(key), options: { encoding: 'utf8' } })
    if (typeof r === 'string') s = r
  } catch (e) {
    // no file yet, or unreadable
  }
  cache.set(key, s)
  return s
}

export function get(key, fallback) {
  const s = text(key)
  if (s === '') return fallback
  try {
    return JSON.parse(s)
  } catch (e) {
    return fallback
  }
}

export function set(key, value) {
  const s = JSON.stringify(value)
  if (cache.get(key) === s) return // unchanged: no flash write
  writeFileSync({ path: file(key), data: s, options: { encoding: 'utf8' } })
  cache.set(key, s)
}
