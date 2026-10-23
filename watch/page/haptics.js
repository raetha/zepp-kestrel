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

function buzz(mode) {
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
