// How fast does each sensor really report in each frequency mode?
// Zepp OS documents LOW / NORMAL / HIGH but not their Hz. A snap detector
// needs roughly 50 Hz or more from the accelerometer. Compass modes need API 4.0.

import { SENSORS } from '../sensors.js'
import { RateMeter } from '../../../lib/rate.js'
import { sleep, guard } from './util.js'

const RUN_MS = 5000
const RUNS = [
  ['accel', 'LOW'],
  ['accel', 'NORMAL'],
  ['accel', 'HIGH'],
  ['gyro', 'LOW'],
  ['gyro', 'NORMAL'],
  ['gyro', 'HIGH'],
  ['compass', 'LOW'],
  ['compass', 'NORMAL'],
  ['compass', 'HIGH'],
]

export const ratesProbe = {
  title: 'Sensor rates',
  start(ctx) {
    const once = guard()
    let active = null
    ctx.onCleanup(() => active && active.stop())

    ctx.status(`Measures each sensor for ${RUN_MS / 1000} s per mode (${(RUNS.length * RUN_MS) / 1000} s total).\n\nMove the watch gently the whole time so readings change.`)
    ctx.primary('Start', () =>
      once(async () => {
        const lines = []
        const results = []
        for (let i = 0; i < RUNS.length; i++) {
          const [kind, mode] = RUNS[i]
          const label = `${kind} ${mode}`
          ctx.status(`${lines.join('\n')}\n\n${i + 1}/${RUNS.length}  ${label}…`)
          const meter = new RateMeter()
          active = SENSORS[kind]()
          active.start(mode, (r) => meter.tick(r.t, kind === 'compass' ? r.angle : [r.x, r.y, r.z]))
          await sleep(RUN_MS)
          if (active) active.stop()
          active = null
          if (!ctx.alive()) return
          const rep = meter.report(RUN_MS)
          results.push({ sensor: kind, mode, ...rep })
          lines.push(`${label}: ${rep.hz} Hz (${rep.distinctHz} new)`)
        }
        ctx.status(lines.join('\n'))
        ctx.primary('Run again')
        ctx.log({ results })
      }),
    )
  },
}
