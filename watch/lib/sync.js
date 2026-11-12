// Keeping the watch's paints and rooms in step with Home Assistant, which
// holds the master copy (and where they can be edited in the integration's
// options). Each section has a revision number that Home Assistant raises on
// every change. The watch remembers the revision it last synced and which
// entries it changed since ("dirty": a new paint, a correction, a room
// calibration).

/**
 * Merge one section (paints or rooms: { key: value }).
 * @returns { value, push } where push says the result must be sent back.
 *  - Home Assistant unchanged since the last sync: keep the watch's copy,
 *    and send it if anything changed on the watch.
 *  - Home Assistant changed (edited in the options, or by another sync):
 *    take its copy, but keep what the watch changed since, and send that.
 */
export function mergeSection(local, localRev, dirty, remote, remoteRev) {
  const changed = (dirty || []).length > 0
  if (remoteRev === localRev) return { value: { ...(local || {}) }, push: changed }
  const value = { ...(remote || {}) }
  for (const key of dirty || []) {
    if (local && local[key] !== undefined) value[key] = local[key]
    else delete value[key]
  }
  return { value, push: changed }
}

/** Add a key to a dirty list once. */
export function markDirty(dirty, key) {
  const list = dirty || []
  return list.includes(key) ? list : [...list, key]
}
