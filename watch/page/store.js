// What the watch keeps between runs: the synced target list and painted spots.

import { LocalStorage } from '@zos/storage'

const ls = new LocalStorage()

function read(key, fallback) {
  try {
    const v = ls.getItem(key)
    return v === undefined || v === null || v === '' ? fallback : JSON.parse(v)
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  ls.setItem(key, JSON.stringify(value))
}

/** [{ id, name, domain, area, dimmable, confirm }] from the last sync */
export const targets = () => read('targets', [])
export const saveTargets = (list) => write('targets', list)

/** { [targetId]: [spot, ...] } */
export const paints = () => read('paints', {})
export const savePaints = (p) => write('paints', p)

/** Painted devices in the shape the classifier wants, joined with target info. */
export function paintedDevices() {
  const p = paints()
  const byId = {}
  for (const t of targets()) byId[t.id] = t
  return Object.keys(p)
    .filter((id) => p[id] && p[id].length)
    .map((id) => ({ ...(byId[id] || { id, name: id, domain: id.split('.')[0] }), id, spots: p[id] }))
}

export function forgetPaints(id) {
  const p = paints()
  delete p[id]
  savePaints(p)
}
