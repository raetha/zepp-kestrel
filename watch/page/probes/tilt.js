// Does the compass heading hold as the arm moves? Zepp OS gives apps the
// compass heading of 12 o'clock, not the raw magnetic field, so we need to
// know whether that heading is tilt-compensated:
//
// - "Up and down": point along one vertical line (a door frame, a wall
//   edge) level, higher, lower, level again. Same direction throughout,
//   so a tilt-compensated heading stays put.
// - "Wrist roll": point at one spot and turn the wrist in and out.
//
// Each recording is 12 s in four 3 s phases, with a buzz at each change.
// The watch shows the forearm heading per phase (attitude() in lib/aim.js);
// the raw samples (compass, accelerometer, gyro at 10 Hz) go to Home
// Assistant so other corrections, like steering with the gyro, can be
// tested on real data.

import { accel, gyro, compass } from '../sensors.js'
import { attitude } from '../../lib/aim.js'
import { circularMean, angleDiff } from '../../../lib/circular.js'
import { mean } from '../../../lib/stats.js'
import * as haptics from '../haptics.js'
import { sleep, guard, cycler, r1 } from './util.js'

const RECORDINGS = {
  'Up and down': [
    ['level', 'Point at a door frame or wall edge, palm down, level'],
    ['up', 'Same line, higher up'],
    ['down', 'Same line, lower down'],
    ['level again', 'Level again'],
  ],
  'Wrist roll': [
    ['flat', 'Point at one spot, palm down'],
    ['turned in', 'Keep pointing; turn the wrist in (thumb up a little)'],
    ['turned out', 'Keep pointing; turn it out (palm up a little)'],
    ['flat again', 'Palm down again'],
  ],
}
const PHASE_MS = 3000
const SETTLE_MS = 1000 // ignore the first second of each phase (moving into the pose)
const SAMPLE_MS = 100

export const tiltProbe = {
  title: 'Compass tilt',
  start(ctx) {
    const once = guard()
    let lastA = null
    let lastG = null
    const a = accel()
    const g = gyro()
    const c = compass()
    a.start('NORMAL', (s) => {
      lastA = s
    })
    g.start('NORMAL', (s) => {
      lastG = s
    })
    c.start('NORMAL', () => {})
    ctx.onCleanup(() => {
      a.stop()
      g.stop()
      c.stop()
    })

    const which = cycler(ctx, 'Recording', Object.keys(RECORDINGS))
    const results = []

    const intro = () =>
      ctx.status(
        `${results.slice(-1)[0] || 'Up and down: point along one vertical line.\nWrist roll: point at one spot, turn the wrist.'}\n\nPress Record, then follow the prompts (12 s).`,
      )
    intro()

    ctx.primary('Record', () =>
      once(async () => {
        const name = which()
        const phases = RECORDINGS[name]
        for (let s = 3; s > 0; s--) {
          ctx.status(`${phases[0][1]}\n\nStarting in ${s}…`)
          await sleep(700)
          if (!ctx.alive()) return
        }

        const rows = [] // [ms, heading12 x10 (-1 = none), calibrated, ax, ay, az, gx, gy, gz]
        const perPhase = phases.map(() => [])
        const t0 = Date.now()
        for (let p = 0; p < phases.length; p++) {
          haptics.sent()
          ctx.status(`${p + 1}/${phases.length}  ${phases[p][1]}`)
          const phaseStart = Date.now()
          while (Date.now() - phaseStart < PHASE_MS) {
            if (!ctx.alive()) return
            const h = c.read()
            const angle = h && h.calibrated && h.angle !== null ? h.angle : null
            if (lastA) {
              const gg = lastG || { x: 0, y: 0, z: 0 }
              rows.push([
                Date.now() - t0,
                angle === null ? -1 : Math.round(angle * 10),
                h && h.calibrated ? 1 : 0,
                Math.round(lastA.x),
                Math.round(lastA.y),
                Math.round(lastA.z),
                Math.round(gg.x),
                Math.round(gg.y),
                Math.round(gg.z),
              ])
              if (Date.now() - phaseStart >= SETTLE_MS) {
                const att = attitude(lastA.x, lastA.y, lastA.z, angle)
                if (att) perPhase[p].push({ h12: angle, ...att })
              }
            }
            await sleep(SAMPLE_MS)
          }
        }
        haptics.done()

        // Per phase: forearm heading, 12 o'clock heading, pitch, roll.
        const summary = phases.map(([label], p) => {
          const s = perPhase[p]
          const hs = s.filter((x) => x.heading !== null)
          const fh = circularMean(hs.map((x) => x.heading))
          const h12 = circularMean(hs.map((x) => x.h12))
          return {
            phase: label,
            n: s.length,
            heading: fh ? r1(fh.mean) : null,
            spread: fh ? r1(fh.spread) : null,
            heading12: h12 ? r1(h12.mean) : null,
            pitch: s.length ? r1(mean(s.map((x) => x.pitch))) : null,
            roll: s.length ? r1(mean(s.map((x) => x.roll))) : null,
          }
        })
        const ref = summary[0].heading
        for (const s of summary) s.delta = ref === null || s.heading === null ? null : r1(angleDiff(s.heading, ref))

        const lines = summary.map((s) =>
          s.heading === null
            ? `${s.phase}: no heading (calibrate the compass)`
            : `${s.phase}: ${Math.round(s.heading)}°${s.delta ? ` Δ${s.delta > 0 ? '+' : ''}${Math.round(s.delta)}` : ''}  pitch ${Math.round(s.pitch)} roll ${Math.round(s.roll)}`,
        )
        const text = `${name}\n${lines.join('\n')}`
        results.push(text)
        ctx.status(text)
        ctx.primary('Record again')
        ctx.log({ recording: name, phases: summary, raw: { columns: 'ms,heading12x10,calibrated,ax,ay,az,gx,gy,gz', rows } })
      }),
    )
  },
}
