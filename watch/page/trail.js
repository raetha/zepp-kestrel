// Stores the trail (lib/trail.js) on the watch, and wraps page lifecycles and
// callbacks so an error is recorded (and contained) instead of closing the app.

import { get, set } from './kv.js'
import { getDeviceInfo } from '@zos/device'
import { getPackageInfo } from '@zos/app'
import { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } from '@zos/interaction'
import { append, splitPrevious, describeError } from '../lib/trail.js'

const KEY = 'kestrel.trail'

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
