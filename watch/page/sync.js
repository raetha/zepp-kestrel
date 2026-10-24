// Sync with Home Assistant: targets, areas, settings, paints and rooms.
// Home Assistant holds the master copy (editable in the integration's
// options); the watch sends its own changes. lib/sync.js decides how a
// section merges.

import { METHOD } from '../lib/protocol.js'
import { note, appVersion } from './trail.js'
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
 * @returns { ok, targets, total (when Home Assistant left some out), areas, paints, rooms, error }
 */
export function sync(ask, only = null, opts = {}) {
  // One sync at a time: two at once over Bluetooth made one fail ("Phone not
  // reachable") while the other succeeded. One asked for meanwhile (a paint
  // saved during the launch sync) runs once the current one ends; the home
  // page ignores Sync presses while it is syncing.
  const run = () => syncNow(ask, only, opts)
  const next = running ? running.then(run, run) : run()
  const mine = next.finally(() => {
    if (running === mine) running = null
  })
  running = mine
  return mine
}

let running = null

async function syncNow(ask, only = null, { full = false } = {}) {
  // settings changed on the watch (gesture, instant toggle) that didn't reach Home Assistant yet go first
  const dirty = syncMeta().settingsDirty
  if (dirty.length) {
    const changed = {}
    for (const group of dirty) changed[group] = settings()[group]
    const g = await ask(METHOD.SAVE_SETTINGS, { settings: changed }, 15000).catch(() => null)
    if (g && g.ok) {
      saveSyncMeta({ settingsDirty: [], settingsRev: g.rev })
      if (g.settings) saveSettings(g.settings)
    }
  }

  const params = {}
  if (only) params.only = only
  if (!full) params.have = have()
  params.version = appVersion() // shown on the watch's device in Home Assistant
  let r = await ask(METHOD.SYNC, params, 20000).catch(() => null)
  if (!r) return { ok: false, error: 'Phone not reachable' }
  if (r.error) return { ok: false, error: r.error }

  // paired again (a new watch in Home Assistant): the synced revisions are
  // stale; the watch's own paints and rooms are kept and sent to the new one
  if (r.watch_id && syncMeta().watchId && r.watch_id !== syncMeta().watchId) {
    resetSyncMeta()
    if (!full) return syncNow(ask, null, { full: true })
  }
  if (r.watch_id) saveSyncMeta({ watchId: r.watch_id })

  if (r.targets) {
    saveTargets(r.targets)
    saveSyncMeta({ targetsHash: r.targets_hash || null, targetsTotal: r.targets_total || null })
  }
  if (r.areas) saveAreas(r.areas)
  // what each sync brought, for the diagnostics (trail)
  note('sync', { only, full, keys: Object.keys(r), targets: r.targets ? r.targets.length : null, areas: r.areas ? r.areas.length : null })
  if (r.settings) {
    // Home Assistant's settings win, except changes on the watch still on their way
    const keep = {}
    for (const group of syncMeta().settingsDirty) keep[group] = settings()[group]
    saveSettings({ ...r.settings, ...keep })
    saveSyncMeta({ settingsRev: r.settings_rev })
  }

  const out = { ok: true, targets: targets().length, total: syncMeta().targetsTotal, areas: areas().length }
  for (const name of Object.keys(SECTIONS)) {
    const revKey = `${name}_rev`
    if (r[revKey] === undefined) continue // not asked for
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
