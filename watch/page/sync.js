// Sync with Home Assistant: targets, areas, settings, paints and rooms.
// Home Assistant holds the master copy (editable in the integration's
// options); the watch sends its own changes. lib/sync.js decides how a
// section merges. In direct mode (no integration) only targets are synced.

import { METHOD } from '../lib/protocol.js'
import { note } from './trail.js'
import { mergeSection } from '../lib/sync.js'
import {
  targets,
  areas,
  saveTargets,
  saveAreas,
  resetSyncMeta,
  syncMeta,
  saveSyncMeta,
  paints,
  savePaints,
  rooms,
  saveRooms,
  settings,
  saveSettings,
} from './store.js'

const SECTIONS = {
  paints: { read: paints, write: savePaints, rev: 'paintsRev', dirty: 'paintsDirty' },
  rooms: { read: rooms, write: saveRooms, rev: 'roomsRev', dirty: 'roomsDirty' },
}

/**
 * @param ask (method, params, timeoutMs) => Promise, usually ask() bound to a page
 * @param only null for everything, or ['paints'] / ['rooms'] after a change
 * @param full true to fetch everything (the Sync button); otherwise the watch
 *        says what it has and Home Assistant sends only what changed
 * @returns { ok, targets, areas, paints, rooms, error }
 */
export async function sync(ask, only = null, { full = false } = {}) {
  // a gesture calibration that didn't reach Home Assistant yet goes first
  if (syncMeta().gestureDirty) {
    const g = await ask(METHOD.SAVE_GESTURE, { gesture: settings().gesture }, 15000).catch(() => null)
    if (g && g.ok) {
      saveSyncMeta({ gestureDirty: false, settingsRev: g.rev })
      if (g.settings) saveSettings(g.settings)
    }
  }

  const params = {}
  if (only) params.only = only
  if (!full) params.have = have()
  let r = await ask(METHOD.SYNC, params, 20000).catch(() => null)
  if (!r) return { ok: false, error: 'Phone not reachable' }
  if (r.error) return { ok: false, error: r.error }

  // paired again (a new watch in Home Assistant): the synced revisions are
  // stale; the watch's own paints and rooms are kept and sent to the new one
  if (r.watch_id && syncMeta().watchId && r.watch_id !== syncMeta().watchId) {
    resetSyncMeta()
    if (!full) return sync(ask, null, { full: true })
  }
  if (r.watch_id) saveSyncMeta({ watchId: r.watch_id })

  if (r.targets) {
    saveTargets(r.targets)
    saveSyncMeta({ targetsHash: r.targets_hash || null })
  }
  if (r.areas) saveAreas(r.areas)
  // what each sync brought, for the diagnostics (trail)
  note('sync', { only, full, keys: Object.keys(r), targets: r.targets ? r.targets.length : null, areas: r.areas ? r.areas.length : null })
  if (r.settings) {
    // Home Assistant's settings win, except a gesture calibration still on its way
    const keep = syncMeta().gestureDirty ? { gesture: settings().gesture } : {}
    saveSettings({ ...r.settings, ...keep })
    saveSyncMeta({ settingsRev: r.settings_rev })
  }

  const out = { ok: true, targets: targets().length, areas: areas().length }
  for (const name of Object.keys(SECTIONS)) {
    const revKey = `${name}_rev`
    if (r[revKey] === undefined) continue // direct mode, or not asked for
    const s = SECTIONS[name]
    const meta = syncMeta()
    // left out = unchanged in Home Assistant since the watch's copy
    const remote = r[name] === undefined || r[name] === null ? s.read() : r[name]
    const m = mergeSection(s.read(), meta[s.rev], meta[s.dirty], remote, r[revKey])
    s.write(m.value)
    saveSyncMeta({ [s.rev]: r[revKey], ...(m.push ? {} : { [s.dirty]: [] }) })
    if (m.push) {
      const saved = await ask(METHOD.SAVE, { section: name, value: m.value }, 15000).catch(() => null)
      if (saved && saved.ok) saveSyncMeta({ [s.rev]: saved.rev, [s.dirty]: [] })
    }
    out[name] = Object.keys(m.value).length
  }
  return out
}

/** What the watch already has, so Home Assistant can leave it out. */
function have() {
  const m = syncMeta()
  const h = { paints: m.paintsRev, rooms: m.roomsRev, settings: m.settingsRev }
  if (m.targetsHash && targets().length) h.targets = m.targetsHash
  return h
}

/** After a change on the watch: sync just that section, quietly. */
export function syncSoon(ask, section) {
  sync(ask, [section]).catch(() => null)
}
