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

/** Prevents a second press from starting a run while one is going. */
export function guard() {
  let busy = false
  return async (fn) => {
    if (busy) return
    busy = true
    try {
      await fn()
    } finally {
      busy = false
    }
  }
}

export const r1 = (v) => Math.round(v * 10) / 10
