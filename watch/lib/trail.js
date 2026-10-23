// A short trail of what the app did (screens opened and closed, buttons and
// swipes, errors), kept on the watch so the next launch can send it to Home
// Assistant. It explains crashes and exits we can't see from here.
// Entries are [ms timestamp, kind, data]; a 'launch' entry starts each run.

export const TRAIL_MAX = 80

/** Append an entry, keeping the newest `max`. Mutates and returns the list. */
export function append(list, entry, max = TRAIL_MAX) {
  list.push(entry)
  while (list.length > max) list.shift()
  return list
}

/**
 * Split at the newest 'launch': `previous` holds earlier runs (to report),
 * `current` this run. Without a launch marker everything counts as current.
 */
export function splitPrevious(list) {
  let i = list.length - 1
  while (i >= 0 && list[i][1] !== 'launch') i--
  if (i <= 0) return { previous: [], current: list.slice() }
  return { previous: list.slice(0, i), current: list.slice(i) }
}

/** An error as plain data. */
export function describeError(where, e) {
  return {
    where,
    message: String((e && e.message) || e),
    stack: String((e && e.stack) || '').slice(0, 600),
  }
}
