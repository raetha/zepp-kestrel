// Circular statistics for compass headings (degrees, 0 = north, clockwise).
// Pure JS: no @zos imports, so it runs on the watch and under Node tests.

const RAD = Math.PI / 180

/** Normalize any angle to [0, 360). */
export function wrap360(deg) {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

/** Signed smallest difference a - b, in (-180, 180]. */
export function angleDiff(a, b) {
  let d = wrap360(a - b)
  if (d > 180) d -= 360
  return d
}

/**
 * Weighted circular mean of headings.
 * Returns { mean, r, spread } where r is the mean resultant length (0..1,
 * 1 = all identical) and spread is the circular standard deviation in degrees.
 * Returns null for empty input or perfectly opposed samples.
 */
export function circularMean(degs, weights) {
  let s = 0
  let c = 0
  let wsum = 0
  for (let i = 0; i < degs.length; i++) {
    const w = weights ? weights[i] : 1
    s += w * Math.sin(degs[i] * RAD)
    c += w * Math.cos(degs[i] * RAD)
    wsum += w
  }
  if (wsum <= 0) return null
  const r = Math.sqrt(s * s + c * c) / wsum
  if (r < 1e-9) return null
  const mean = wrap360(Math.atan2(s, c) / RAD)
  // Circular SD: sqrt(-2 ln R), in degrees.
  const spread = Math.sqrt(-2 * Math.log(Math.min(1, r))) / RAD
  return { mean, r, spread }
}
