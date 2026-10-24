// Narrowing a long device list to one Home Assistant area, for picking a
// device on a small screen. Targets carry area_id (and area, its name; older
// syncs had only the name).

export const ALL = { id: '__all', name: 'All devices' }
export const NONE = { id: '__none', name: 'No area' }

/** The targets in an area (or ALL, or NONE: those without an area). */
export function targetsInArea(targets, area) {
  if (!area || area.id === ALL.id) return targets
  if (area.id === NONE.id) return targets.filter((t) => !t.area_id && !t.area)
  return targets.filter((t) => (t.area_id ? t.area_id === area.id : t.area === area.name))
}

/**
 * Areas to choose from, with how many targets each has: areas with devices
 * first (in the given order), then "No area" if any, then "All devices".
 * @returns [{ id, name, count }]
 */
export function areaChoices(targets, areas) {
  const out = []
  for (const a of areas || []) {
    const count = targetsInArea(targets, a).length
    if (count) out.push({ id: a.id, name: a.name, count })
  }
  const none = targetsInArea(targets, NONE).length
  if (none) out.push({ ...NONE, count: none })
  out.push({ ...ALL, count: targets.length })
  return out
}
