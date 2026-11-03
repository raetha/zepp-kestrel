export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A label button that cycles through options. Returns a getter for the current one. */
export function cycler(ctx, prefix, options) {
  let i = 0
  const show = () => ctx.secondary(`${prefix}: ${options[i]}`)
  ctx.secondary(`${prefix}: ${options[i]}`, () => {
    i = (i + 1) % options.length
    show()
  })
  return () => options[i]
}

/**
 * Prevents a second press from starting a run while one is going, and keeps
 * the screen on during the run only (ctx.awake), so the watch times out
 * normally before and after.
 */
export function guard(ctx) {
  let busy = false
  return async (fn) => {
    if (busy) return
    busy = true
    if (ctx) ctx.awake(true)
    try {
      await fn()
    } finally {
      busy = false
      if (ctx) ctx.awake(false)
    }
  }
}

export const r1 = (v) => Math.round(v * 10) / 10
