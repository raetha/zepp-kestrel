// Sync with Home Assistant: targets, areas, settings, paints and rooms.
// Home Assistant holds the master copy (editable in the integration's
// options); the watch sends its own changes. lib/sync.js decides how a
// section merges. In direct mode (no integration) only targets are synced.

import { METHOD } from '../lib/protocol.js'
import { note } from './trail.js'
import { mergeSection } from '../lib/sync.js'
import {
  saveTargets,
  saveAreas,
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
 * @returns { ok, targets, paints, rooms, error }
 */
export async function sync(ask, only = null) {
  // a gesture calibration that didn't reach Home Assistant yet goes first
  if (syncMeta().gestureDirty) {
    const g = await ask(METHOD.SAVE_GESTURE, { gesture: settings().gesture }, 15000).catch(() => null)
    if (g && g.ok) {
      saveSyncMeta({ gestureDirty: false, settingsRev: g.rev })
      if (g.settings) saveSettings(g.settings)
    }
  }

  const r = await ask(METHOD.SYNC, only ? { only } : undefined, 20000).catch(() => null)
  if (!r) return { ok: false, error: 'Phone not reachable' }
  if (r.error) return { ok: false, error: r.error }
  const out = { ok: true }

  if (r.targets) {
    saveTargets(r.targets)
    out.targets = r.targets.length
  }
  if (r.areas) {
    saveAreas(r.areas)
    out.areas = r.areas.length
  }
  // what each sync brought, for the diagnostics (trail)
  note('sync', { only, keys: Object.keys(r), targets: r.targets ? r.targets.length : null, areas: r.areas ? r.areas.length : null })
  if (r.settings) {
    // Home Assistant's settings win, except a gesture calibration still on its way
    const keep = syncMeta().gestureDirty ? { gesture: settings().gesture } : {}
    saveSettings({ ...r.settings, ...keep })
    saveSyncMeta({ settingsRev: r.settings_rev })
  }

  for (const name of Object.keys(SECTIONS)) {
    if (r[name] === undefined || r[name] === null) continue // direct mode, or not asked for
    const s = SECTIONS[name]
    const meta = syncMeta()
    const m = mergeSection(s.read(), meta[s.rev], meta[s.dirty], r[name], r[`${name}_rev`])
    s.write(m.value)
    saveSyncMeta({ [s.rev]: r[`${name}_rev`], ...(m.push ? {} : { [s.dirty]: [] }) })
    if (m.push) {
      const saved = await ask(METHOD.SAVE, { section: name, value: m.value }, 15000).catch(() => null)
      if (saved && saved.ok) saveSyncMeta({ [s.rev]: saved.rev, [s.dirty]: [] })
    }
    out[name] = Object.keys(m.value).length
  }
  return out
}

/** After a change on the watch: sync just that section, quietly. */
export function syncSoon(ask, section) {
  sync(ask, [section]).catch(() => null)
}
