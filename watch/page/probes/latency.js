// How long does a command take? Splits the trip into watch <-> phone
// (Bluetooth) and phone <-> Home Assistant (network). Target: under 500 ms
// end to end for the "it just happened" feeling.

import { METHOD } from '../../lib/protocol.js'
import { summarize } from '../../../lib/stats.js'
import { guard } from './util.js'

const ROUNDS = 20

export const latencyProbe = {
  title: 'Latency',
  start(ctx) {
    const once = guard(ctx)
    ctx.status(`Times ${ROUNDS} round trips to the phone, then ${ROUNDS} to Home Assistant via the phone.\n\nPair with Home Assistant first.`)
    ctx.primary('Run', () =>
      once(async () => {
        const bt = []
        const total = []
        const ha = []
        let haError = null

        for (let i = 0; i < ROUNDS; i++) {
          if (!ctx.alive()) return
          ctx.status(`Phone ${i + 1}/${ROUNDS}`)
          const t0 = Date.now()
          try {
            await ctx.request(METHOD.PING, {})
            bt.push(Date.now() - t0)
          } catch (e) {
            ctx.status('Phone not reachable. Is the Zepp app open and connected?')
            return
          }
        }

        for (let i = 0; i < ROUNDS; i++) {
          if (!ctx.alive()) return
          ctx.status(`Home Assistant ${i + 1}/${ROUNDS}`)
          const t0 = Date.now()
          const res = await ctx.request(METHOD.HA_PING, {}).catch((e) => ({ error: String(e && e.message) }))
          if (res && res.error) {
            haError = res.error
            break
          }
          total.push(Date.now() - t0)
          ha.push(res.haMs)
        }

        const b = summarize(bt, 0)
        const lines = [`Watch↔phone: p50 ${b.p50} ms, p90 ${b.p90} ms`]
        if (haError) {
          lines.push(`HA: ${haError}`)
        } else {
          const tt = summarize(total, 0)
          const hh = summarize(ha, 0)
          lines.push(`Phone↔HA: p50 ${hh.p50} ms`)
          lines.push(`Watch→HA total: p50 ${tt.p50} ms, p90 ${tt.p90} ms`)
          lines.push(tt.p90 < 500 ? 'Under the 500 ms target.' : 'Over the 500 ms target.')
        }
        ctx.status(lines.join('\n'))
        ctx.primary('Run again')
        ctx.log({
          watchPhoneMs: b,
          phoneHaMs: haError ? null : summarize(ha, 0),
          totalMs: haError ? null : summarize(total, 0),
          haError,
          // each round in order, to see whether Bluetooth speeds up once busy
          raw: { watchPhone: bt, phoneHa: ha, total },
        })
      }),
    )
  },
}
