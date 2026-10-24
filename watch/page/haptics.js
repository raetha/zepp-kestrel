// Short, distinct buzzes for: command sent, command confirmed, error (long).

import { Vibrator, VIBRATOR_SCENE_SHORT_LIGHT, VIBRATOR_SCENE_SHORT_STRONG, VIBRATOR_SCENE_DURATION } from '@zos/sensor'

let vib = null
function v() {
  if (!vib) {
    try {
      vib = new Vibrator()
    } catch (e) {
      vib = null
    }
  }
  return vib
}

// Pages that detect gestures listen here: a buzz jolts the accelerometer.
const listeners = new Set()
/** fn(ms) is called with roughly how long each buzz lasts. Returns a function that stops listening. */
export function onBuzz(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function buzz(mode) {
  for (const fn of listeners) {
    try {
      fn(mode === VIBRATOR_SCENE_DURATION ? 1200 : 500)
    } catch (e) {
      // a listener's problem
    }
  }
  try {
    const x = v()
    if (!x) return
    x.stop()
    x.start({ mode })
  } catch (e) {
    // haptics are a nicety
  }
}

export const sent = () => buzz(VIBRATOR_SCENE_SHORT_LIGHT)
export const done = () => buzz(VIBRATOR_SCENE_SHORT_STRONG)
export const failed = () => buzz(VIBRATOR_SCENE_DURATION)
export const long = failed
