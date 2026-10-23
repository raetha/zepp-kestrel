// What the watch keeps between runs: the synced target list and painted spots.

import { LocalStorage } from '@zos/storage'
import { METHOD } from '../lib/protocol.js'

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

/**
 * { [targetId]: [spot, ...] }. 'paints2': spots hold the forearm's heading.
 * Spots from earlier builds ('paints') held 12 o'clock's heading and are dropped.
 */
export const paints = () => read('paints2', {})
export const savePaints = (p) => write('paints2', p)

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

/** Flick-to-trigger: { enabled, threshold (deg/s), calibrated }. On by default. */
export const flickSettings = () => ({ enabled: true, threshold: 600, calibrated: false, ...read('ww.flick', {}) })
export const saveFlickSettings = (f) => write('ww.flick', { ...flickSettings(), ...f })

/** Send the paints to Home Assistant for safe keeping. Fire and forget. */
export function backupPaints(ask) {
  try {
    const p = paints()
    if (Object.keys(p).length) ask(METHOD.SAVE_PAINTS, { paints: p }).catch(() => null)
  } catch (e) {
    // a backup is best effort
  }
}
