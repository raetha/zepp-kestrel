// What the watch keeps between runs. Home Assistant (with the Kestrel
// integration) holds the master copy of paints, rooms and settings; see
// page/sync.js and lib/sync.js for how they're kept in step.

import { markDirty } from '../lib/sync.js'
import { get as read, set as write } from './kv.js'

/** [{ id, name, domain, area, dimmable, confirm }] from the last sync */
export const targets = () => read('kestrel.targets', [])
export const saveTargets = (list) => write('kestrel.targets', list)

/** [{ id, name }] Home Assistant areas, from the last sync */
export const areas = () => read('kestrel.areas', [])
export const saveAreas = (list) => write('kestrel.areas', list)

// ---------------------------------------------------------------- sync state
/** { watchId, targetsHash, targetsTotal, paintsRev, paintsDirty, roomsRev, roomsDirty, settingsRev, settingsDirty: [group] } */
const META_DEFAULTS = { watchId: null, targetsHash: null, targetsTotal: null, paintsRev: 0, paintsDirty: [], roomsRev: 0, roomsDirty: [], settingsRev: 0, settingsDirty: [] }
export const syncMeta = () => ({ ...META_DEFAULTS, ...read('kestrel.sync', {}) })
export const saveSyncMeta = (m) => write('kestrel.sync', { ...syncMeta(), ...m })
/** Forget what was synced (paired with Home Assistant again). Local paints stay, as changes to send. */
export function resetSyncMeta() {
  write('kestrel.sync', { ...META_DEFAULTS, paintsDirty: Object.keys(paints()), roomsDirty: Object.keys(rooms()) })
}

// ---------------------------------------------------------------- paints
/**
 * { [targetId]: [spot, ...] }. Each spot holds the forearm's heading.
 */
export const paints = () => read('kestrel.paints', {})
/** Replace all paints (from a sync). */
export const savePaints = (p) => write('kestrel.paints', p)

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
export const rooms = () => read('kestrel.rooms', {})
export const saveRooms = (r) => write('kestrel.rooms', r)

export function setRoom(areaId, room) {
  const r = rooms()
  if (room) r[areaId] = room
  else delete r[areaId]
  saveRooms(r)
  saveSyncMeta({ roomsDirty: markDirty(syncMeta().roomsDirty, areaId) })
}

// ---------------------------------------------------------------- settings
export const DEFAULT_SETTINGS = {
  // calibrations: { flick | snap | tap: { gyro, jolt } }; see gestureThresholds() in lib/gesture.js
  gesture: { enabled: true, kind: 'flick', calibrations: {} },
  room: { source: 'watch', sensor: null },
  // instant toggle: trigger by holding the aim on a device this many seconds
  dwell: { enabled: false, seconds: 3 },
  // open straight on Point when the app starts (for the watch's shortcut key)
  start: { point: false },
  // twisting at a media player: Home Assistant caps it at max %, and one twist at step %
  volume: { max: 80, step: 20 },
  // learn from use: confirmed triggers refine paints, clear room checks refine rooms (lib/learn.js)
  learn: { enabled: true },
  // how long Kestrel's screens stay on without a touch (page/screen.js)
  screen: { seconds: 30 },
  // detailed diagnostics (turned on in Home Assistant, off again after a week): also send aim
  // traces, the screen and button trail, and room scans
  diagnostics: { detailed: false },
}

/** Settings from Home Assistant (with defaults filled in). */
export function settings() {
  const s = read('kestrel.settings', {})
  const out = {}
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = { ...DEFAULT_SETTINGS[k], ...(s[k] || {}) }
  return out
}
export const saveSettings = (s) => write('kestrel.settings', s)

export const gesture = () => settings().gesture

/** Change one settings group on the watch ('gesture', 'dwell', 'start'); sent to Home Assistant. */
export function setSetting(group, values) {
  const s = settings()
  s[group] = { ...s[group], ...values }
  saveSettings(s)
  saveSyncMeta({ settingsDirty: markDirty(syncMeta().settingsDirty, group) })
}

/** Change the gesture settings on the watch (calibration, choice, on/off). */
export const setGesture = (values) => setSetting('gesture', values)
