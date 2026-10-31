// Stores the trail (lib/trail.js) on the watch, and wraps page lifecycles and
// callbacks so an error is recorded (and contained) instead of closing the app.

import { get, set } from './kv.js'
import { getDeviceInfo } from '@zos/device'
import { getPackageInfo } from '@zos/app'
import { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } from '@zos/interaction'
import { append, splitPrevious, describeError } from '../lib/trail.js'
import { holdScreen } from './screen.js'

const KEY = 'kestrel.trail'
const BUILDS_KEY = 'kestrel.builds'
const BUILDS_MAX = 10

function read() {
  const v = get(KEY, [])
  return Array.isArray(v) ? v : []
}

function write(list) {
  try {
    set(KEY, list)
  } catch (e) {
    // the trail is best effort
  }
}

export function note(kind, data = null) {
  write(append(read(), [Date.now(), kind, data]))
}

/**
 * Note something once per run of the app (the app's globalData outlives pages):
 * for a state that every page would otherwise note again.
 */
export function noteOnce(key, kind, data = null) {
  let g = null
  try {
    const app = getApp()
    g = app && app._options && app._options.globalData
  } catch (e) {
    g = null
  }
  if (g) {
    g.noted = g.noted || {}
    if (g.noted[key]) return
    g.noted[key] = true
  }
  note(kind, data)
}

/**
 * Each change in the builds the two halves run: [time, watch build, phone build].
 * Kept apart from the trail (which keeps only its newest entries) so the moment
 * a mismatch began survives, and sent with every trail. phone: the side
 * service's build, 'unknown method' when it couldn't say, undefined = not asked.
 */
export function noteBuilds(watch, phone) {
  let list = get(BUILDS_KEY, [])
  if (!Array.isArray(list)) list = []
  const last = list[list.length - 1]
  const p = phone === undefined ? (last ? last[2] : null) : phone
  if (last && last[1] === watch && last[2] === p) return
  list.push([Date.now(), watch, p])
  while (list.length > BUILDS_MAX) list.shift()
  try {
    set(BUILDS_KEY, list)
  } catch (e) {
    // best effort
  }
}

export const builds = () => {
  const v = get(BUILDS_KEY, [])
  return Array.isArray(v) ? v : []
}

/** Entries from earlier runs, not yet sent. */
export const previousRuns = () => splitPrevious(read()).previous

/** Drop the earlier runs once they've reached Home Assistant. */
export function forgetPreviousRuns() {
  write(splitPrevious(read()).current)
}

/** Wrap a callback: an error is noted and swallowed. */
export function safe(where, fn) {
  return function (...args) {
    try {
      return fn.apply(this, args)
    } catch (e) {
      note('error', describeError(where, e))
      return undefined
    }
  }
}

/** A page definition whose onInit, build and onDestroy are noted and guarded. */
export function tracked(name, def) {
  const out = { ...def }
  for (const k of ['onInit', 'build', 'onDestroy']) {
    const f = def[k]
    out[k] = function (...args) {
      if (k === 'onInit') note('open', name)
      if (k === 'build') holdScreen() // every Kestrel screen stays on as long as the settings say
      if (k === 'onDestroy') note('close', name)
      if (!f) return undefined
      try {
        return f.apply(this, args)
      } catch (e) {
        note('error', describeError(`${name}.${k}`, e))
        return undefined
      }
    }
  }
  return out
}


/**
 * Note the start of a run, once per run (the home page calls this on every
 * visit): device details and which code each button sends on this watch.
 */
export function noteLaunch() {
  let g = null
  try {
    const app = getApp()
    g = app && app._options && app._options.globalData
  } catch (e) {
    g = null
  }
  if (g && g.launched) return
  if (g) g.launched = true
  let device = null
  try {
    const d = getDeviceInfo()
    device = { source: d.deviceSource, width: d.width, height: d.height, shape: d.screenShape }
  } catch (e) {
    device = { error: String((e && e.message) || e) }
  }
  note('launch', { version: appVersion(), device, keys: { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } })
  noteBuilds(appVersion())
}

/**
 * The watch's own unique id (Zepp OS 4.2+), or null: sent when pairing and syncing so
 * Home Assistant (which keeps only a hash of it) gives the same watch its own record
 * back when it pairs again, instead of a new, empty one.
 */
export function deviceId() {
  try {
    const id = getDeviceInfo().uuid
    return typeof id === 'string' && id ? id : null
  } catch (e) {
    return null
  }
}

/** This build's version, e.g. "0.1.0-dev.187", or "" if the firmware won't say. */
export function appVersion() {
  try {
    const v = getPackageInfo().version
    return (v && (v.name || v)) || ''
  } catch (e) {
    return ''
  }
}
