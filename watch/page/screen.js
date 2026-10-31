// How long Kestrel's screens stay on without a touch, whatever the watch's own
// screen timeout (often 5-10 s: too short to read a result or a hint). A
// per-watch setting (More -> Screen, or Home Assistant), 30 s by default.

import { setPageBrightTime } from '@zos/display'
import { settings } from './store.js'

export const SCREEN_STEPS = [10, 20, 30, 60] // More -> Screen cycles through these (any 5-120 s in Home Assistant)

export function screenMs() {
  const s = Number((settings().screen || {}).seconds)
  return Math.max(5, Math.min(120, Number.isFinite(s) && s > 0 ? s : 30)) * 1000
}

/** Give the current page the screen time from the settings. */
export function holdScreen() {
  try {
    setPageBrightTime({ brightTime: screenMs() })
  } catch (e) {
    // older firmware: the watch's own timeout applies
  }
}
