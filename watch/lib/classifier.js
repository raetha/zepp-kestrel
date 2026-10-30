// Which painted device is the arm pointing at?
//
// Each device has one or more spots (from painting). A spot scores the current
// aim with a 2D Gaussian on (heading difference, pitch difference); a device's
// score is its best spot. The state machine on top decides how sure we are.
//
// Two numbers per device: `score` (0..1, how well the aim fits that spot) decides
// whether anything matches at all; `weight` (the Gaussian's density: the score
// divided by the spot's width, times its room prior) decides which device wins and
// by how much. Comparing plain scores let a widely swept spot claim most of the
// space between it and a tight neighbour: on a real watch, a chandelier painted
// with a 14° sweep beat an island light 18° away until the arm was within 5° of
// the island, and the island never locked.

import { angleDiff } from './circular.js'

export const STATE = {
  RESTING: 'resting', // arm not held out and still
  AIMING: 'aiming', // arm held out, nothing matches well
  CANDIDATE: 'candidate', // one device matches, but not decisively
  LOCKED: 'locked', // one device matches decisively: trigger now
}

export const DEFAULTS = {
  minHeadingSigma: 6, // degrees: painted spreads are floored at these
  minPitchSigma: 5,
  maxHeadingSigma: 15, // a wide sweep says how far the arm wandered, not how big the target is
  headingSigmaScale: 1.5, // widen the painted spread a little: aiming is looser than painting
  pitchSigmaScale: 1.5,
  candidateScore: 0.25, // best score needed to show a candidate
  lockScore: 0.5, // best score needed to lock
  lockMargin: 2, // best must beat the runner-up by this factor to lock
  lockHoldMs: 250, // ...for this long
  // A device with nothing else painted anywhere near may lock further off its
  // paint: the compass is often 7-12 degrees out from one visit to the next (real
  // Balance 3: a light painted at 181 read 169 from the same spot, and stayed
  // amber until the arm moved). Score 0.1 is about 2 spreads out (13 degrees at
  // the narrowest), and only when it leads everything else 8x. A loose lock
  // shows and triggers like any lock, but doesn't start instant toggle.
  looseScore: 0.1,
  looseMargin: 8,
}

/** Score 0..1 for one spot. */
export function scoreSpot(spot, heading, pitch, o = DEFAULTS) {
  return fitSpot(spot, heading, pitch, o).score
}

/** { score 0..1, weight }: weight is the density, relative to the narrowest possible spot, times spot.prior. */
export function fitSpot(spot, heading, pitch, o = DEFAULTS) {
  const sh = Math.min(Math.max(spot.headingSpread * o.headingSigmaScale, o.minHeadingSigma), Math.max(o.maxHeadingSigma, o.minHeadingSigma))
  const sp = Math.max(spot.pitchSpread * o.pitchSigmaScale, o.minPitchSigma)
  const dh = angleDiff(heading, spot.heading) / sh
  const dp = (pitch - spot.pitch) / sp
  const score = Math.exp(-0.5 * (dh * dh + dp * dp))
  const prior = typeof spot.prior === 'number' ? spot.prior : 1
  return { score, weight: (score * prior * o.minHeadingSigma * o.minPitchSigma) / (sh * sp) }
}

/**
 * Rank devices for an aim.
 * @param devices [{ id, spots: [spot] }]
 * @returns [{ id, score, weight }] best (highest weight) first; devices without spots are skipped
 */
export function rank(devices, heading, pitch, o = DEFAULTS) {
  const out = []
  for (const d of devices) {
    if (!d.spots || !d.spots.length) continue
    let score = 0
    let weight = 0
    for (const s of d.spots) {
      const f = fitSpot(s, heading, pitch, o)
      score = Math.max(score, f.score)
      weight = Math.max(weight, f.weight)
    }
    out.push({ id: d.id, score, weight })
  }
  out.sort((a, b) => b.weight - a.weight || b.score - a.score)
  return out
}

/** Turns a stream of aims into states, with a short hold before locking. */
export class Aimer {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts }
    this.lockSince = null
    this.lockId = null
  }

  /**
   * @param t        ms timestamp
   * @param ready    aim gate passed (arm out, still, compass calibrated)
   * @returns { state, best: {id, score} | null, runnerUp: {id, score} | null, loose? }
 *          loose: locked only because nothing else is near (see looseScore)
   */
  update(t, ready, devices, heading, pitch) {
    if (!ready) {
      this.lockSince = null
      this.lockId = null
      return { state: STATE.RESTING, best: null, runnerUp: null }
    }
    const ranked = rank(devices, heading, pitch, this.o)
    const best = ranked[0] || null
    const runnerUp = ranked[1] || null
    const leads = (margin) => !runnerUp || best.weight >= runnerUp.weight * margin
    const loose = !!best && best.score < this.o.lockScore && best.score >= this.o.looseScore && leads(this.o.looseMargin)
    if (!best || (best.score < this.o.candidateScore && !loose)) {
      this.lockSince = null
      this.lockId = null
      return { state: STATE.AIMING, best: null, runnerUp: null }
    }
    const decisive = loose || (best.score >= this.o.lockScore && leads(this.o.lockMargin))
    if (decisive) {
      if (this.lockId !== best.id) {
        this.lockId = best.id
        this.lockSince = t
      }
      if (t - this.lockSince >= this.o.lockHoldMs) return { state: STATE.LOCKED, best, runnerUp, loose }
    } else {
      this.lockSince = null
      this.lockId = null
    }
    return { state: STATE.CANDIDATE, best, runnerUp }
  }
}
