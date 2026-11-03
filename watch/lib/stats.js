// Summary statistics. The maths comes from simple-statistics (ISC, maintained);
// this file only adds the compact summary the probes and reports use.

import { mean as ssMean, median as ssMedian, quantile, standardDeviation } from 'simple-statistics'

export function percentile(values, p) {
  return values.length ? quantile(values, p) : null
}

export function median(values) {
  return values.length ? ssMedian(values) : null
}

export function mean(values) {
  return values.length ? ssMean(values) : null
}

/** Population standard deviation (0 for fewer than two values). */
export function stdev(values) {
  return values.length > 1 ? standardDeviation(values) : 0
}

/** Summary used in probe reports: n, min, p50, p90, max (rounded). */
export function summarize(values, digits = 1) {
  if (!values.length) return { n: 0 }
  const f = 10 ** digits
  const r = (v) => Math.round(v * f) / f
  return {
    n: values.length,
    min: r(Math.min(...values)),
    p50: r(quantile(values, 0.5)),
    p90: r(quantile(values, 0.9)),
    max: r(Math.max(...values)),
  }
}
