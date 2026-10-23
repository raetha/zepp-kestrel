// What the watch keeps between runs. Home Assistant (with the WristWand
// integration) holds the master copy of paints, rooms and settings; see
// page/sync.js and lib/sync.js for how they're kept in step.

import { LocalStorage } from '@zos/storage'
import { markDirty } from '../lib/sync.js'

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

/** [{ id, name }] Home Assistant areas, from the last sync */
export const areas = () => read('ww.areas', [])
export const saveAreas = (list) => write('ww.areas', list)

// ---------------------------------------------------------------- sync state
/** { paintsRev, paintsDirty, roomsRev, roomsDirty, settingsRev, gestureDirty } */
export const syncMeta = () => ({ paintsRev: 0, paintsDirty: [], roomsRev: 0, roomsDirty: [], settingsRev: 0, gestureDirty: false, ...read('ww.sync', {}) })
export const saveSyncMeta = (m) => write('ww.sync', { ...syncMeta(), ...m })

// ---------------------------------------------------------------- paints
/**
 * { [targetId]: [spot, ...] }. 'paints2': spots hold the forearm's heading.
 * Spots from earlier builds ('paints') held 12 o'clock's heading and are dropped.
 */
export const paints = () => read('paints2', {})
/** Replace all paints (from a sync). */
export const savePaints = (p) => write('paints2', p)

/** Change one device's spots on the watch (null removes it); synced later. */
export function setPaint(id, spots) {
  const p = paints()
  if (spots && spots.length) p[id] = spots
  else delete p[id]
  savePaints(p)
  saveSyncMeta({ paintsDirty: markDirty(syncMeta().paintsDirty, id) })
}

/** Painted devices in the shape the classifier wants, joined with target info. */
export function paintedDevices() {
  const p = paints()
  const byId = {}
  for (const t of targets()) byId[t.id] = t
  return Object.keys(p)
    .filter((id) => p[id] && p[id].length)
    .map((id) => ({ ...(byId[id] || { id, name: id, domain: id.split('.')[0] }), id, spots: p[id] }))
}

// ---------------------------------------------------------------- rooms
/** { [areaId]: { name, fingerprint: { mac: [rssi, seen] }, scans, at } } */
export const rooms = () => read('ww.rooms', {})
export const saveRooms = (r) => write('ww.rooms', r)

export function setRoom(areaId, room) {
  const r = rooms()
  if (room) r[areaId] = room
  else delete r[areaId]
  saveRooms(r)
  saveSyncMeta({ roomsDirty: markDirty(syncMeta().roomsDirty, areaId) })
}

// ---------------------------------------------------------------- settings
export const DEFAULT_SETTINGS = {
  gesture: { enabled: true, kind: 'flick', gyro: 600, jolt: null, calibrated: false },
  away: { block: false, person: null, allowed: [] },
  room: { source: 'watch', sensor: null },
}

/** Settings from Home Assistant (with defaults filled in). */
export function settings() {
  const s = read('ww.settings', {})
  const out = {}
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = { ...DEFAULT_SETTINGS[k], ...(s[k] || {}) }
  return out
}
export const saveSettings = (s) => write('ww.settings', s)

export const gesture = () => settings().gesture

/** Change the gesture settings on the watch (calibration, on/off); sent to Home Assistant. */
export function setGesture(values) {
  const s = settings()
  s.gesture = { ...s.gesture, ...values }
  saveSettings(s)
  saveSyncMeta({ gestureDirty: true })
}
