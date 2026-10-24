// Dimming by twisting the wrist while holding the select button (or a finger
// on the circle): turning the thumb up brightens, down dims. Roll is the
// wrist's turn about the forearm (lib/aim.js); turning the thumb up makes it
// smaller (about -80 at thumb up on a Balance 3).

import { angleDiff } from './circular.js'

export const DIM_DEGREES_FOR_FULL = 90 // a quarter turn is the whole range
export const DIM_STEP = 5 // percent

/** Brightness change in percent (-100..100, in steps of 5) for a twist from roll0 to roll. */
export function dimStep(roll0, roll) {
  const turn = -angleDiff(roll, roll0) // thumb up: positive
  const pct = (turn / DIM_DEGREES_FOR_FULL) * 100
  const stepped = Math.round(pct / DIM_STEP) * DIM_STEP
  return Math.max(-100, Math.min(100, stepped)) || 0
}
