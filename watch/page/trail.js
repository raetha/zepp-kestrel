// Stores the trail (lib/trail.js) on the watch, and wraps page lifecycles and
// callbacks so an error is recorded (and contained) instead of closing the app.

import { LocalStorage } from '@zos/storage'
import { getDeviceInfo } from '@zos/device'
import { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } from '@zos/interaction'
import { append, splitPrevious, describeError } from '../lib/trail.js'

const KEY = 'ww.trail'
let ls = null

function read() {
  try {
    ls = ls || new LocalStorage()
    const v = ls.getItem(KEY)
    return v ? JSON.parse(v) : []
  } catch (e) {
    return []
  }
}

function write(list) {
  try {
    ls = ls || new LocalStorage()
    ls.setItem(KEY, JSON.stringify(list))
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
  note('launch', { device, keys: { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } })
}
