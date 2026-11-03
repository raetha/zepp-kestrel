// Narrowing a long device list to one Home Assistant area, for picking a
// device on a small screen. Targets carry area_id.

export const ALL = { id: '__all', name: 'All devices' }
export const NONE = { id: '__none', name: 'No area' }
// Scenes, scripts and buttons: they run rather than toggle, so they make good
// "virtual spots" (paint the sofa as the movie scene), wherever their area is.
export const ACTIONS = { id: '__actions', name: 'Scenes & more' }
export const ACTION_DOMAINS = ['scene', 'script', 'button', 'input_button']
const isAction = (t) => ACTION_DOMAINS.includes(String(t.id).split('.')[0])

/** The targets in an area (or ALL, or NONE: those without an area). */
export function targetsInArea(targets, area) {
  if (!area || area.id === ALL.id) return targets
  if (area.id === NONE.id) return targets.filter((t) => !t.area_id)
  if (area.id === ACTIONS.id) return targets.filter(isAction)
  return targets.filter((t) => t.area_id === area.id)
}

/**
 * Areas to choose from, with how many targets each has: "Scenes & scripts" if
 * any, areas with devices (in the given order), then "No area" if any, then "All devices".
 * @returns [{ id, name, count }]
 */
export function areaChoices(targets, areas) {
  const out = []
  const actions = targetsInArea(targets, ACTIONS).length
  if (actions) out.push({ ...ACTIONS, count: actions })
  for (const a of areas || []) {
    const count = targetsInArea(targets, a).length
    if (count) out.push({ id: a.id, name: a.name, count })
  }
  const none = targetsInArea(targets, NONE).length
  if (none) out.push({ ...NONE, count: none })
  out.push({ ...ALL, count: targets.length })
  return out
}
