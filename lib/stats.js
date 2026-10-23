// Small numeric helpers shared by the probe and the classifier.

export function percentile(values, p) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function median(values) {
  return percentile(values, 0.5)
}

export function mean(values) {
  if (!values.length) return null
  let s = 0
  for (const v of values) s += v
  return s / values.length
}

/** Summary used in probe reports: n, min, p50, p90, max (rounded). */
export function summarize(values, digits = 1) {
  if (!values.length) return { n: 0 }
  const f = 10 ** digits
  const r = (v) => Math.round(v * f) / f
  return {
    n: values.length,
    min: r(Math.min(...values)),
    p50: r(percentile(values, 0.5)),
    p90: r(percentile(values, 0.9)),
    max: r(Math.max(...values)),
  }
}
