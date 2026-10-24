// Does the compass heading hold as the arm moves? Zepp OS gives apps the
// compass heading of 12 o'clock, not the raw magnetic field, so we need to
// know whether that heading is tilt-compensated:
//
// - "Up and down": point along one vertical line (a door frame, a wall
//   edge) level, higher, lower, level again. Same direction throughout,
//   so a tilt-compensated heading stays put.
// - "Wrist roll": point at one spot and turn the wrist in and out.
//
// Each recording is 16 s in four 4 s steps; each step starts with that many
// buzzes (1, 2, 3, 4) and a long buzz ends it.
// The watch shows the forearm heading per phase (attitude() in lib/aim.js);
// the raw samples (compass, accelerometer, gyro at 10 Hz) go to Home
// Assistant so other corrections, like steering with the gyro, can be
// tested on real data.

import { accel, gyro, compass } from '../sensors.js'
import { attitude } from '../../lib/aim.js'
import { circularMean, angleDiff } from '../../lib/circular.js'
import { mean } from '../../lib/stats.js'
import * as haptics from '../haptics.js'
import { sleep, guard, r1 } from './util.js'

// Each step is announced by that many short buzzes, so the screen needn't be
// read during a recording; a long buzz ends it. All steps are shown before Start.
const RECORDINGS = {
  'Up and down': {
    intro: 'Point at a door frame, palm down.',
    phases: [
      ['level', 'its middle'],
      ['up', 'higher up it'],
      ['down', 'lower down it'],
      ['level again', 'the middle again'],
    ],
  },
  'Wrist roll': {
    intro: 'Point at one spot; turn only the wrist.',
    phases: [
      ['flat', 'palm down'],
      ['turned in', 'thumb up'],
      ['turned out', 'palm up, as far as comfy'],
      ['flat again', 'palm down'],
    ],
  },
}
const PHASE_MS = 4000
const SETTLE_MS = 1500 // ignore the first second of each phase (moving into the pose)
const SAMPLE_MS = 100

// n short buzzes, without blocking the recording loop
function buzzes(n) {
  for (let i = 0; i < n; i++) setTimeout(() => haptics.sent(), i * 300)
}

export const tiltProbe = {
  title: 'Compass tilt',
  start(ctx) {
    const once = guard(ctx)
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

    const names = Object.keys(RECORDINGS)
    let which = 0
    const intro = () => {
      const r = RECORDINGS[names[which]]
      const steps = r.phases.map(([, how], i) => `${i + 1} buzz${i ? 'es' : ''}: ${how}`).join('\n')
      ctx.status(`${r.intro}\n\n${steps}\nLong buzz: done`)
    }
    ctx.secondary(`Recording: ${names[which]}`, () => {
      which = (which + 1) % names.length
      ctx.secondary(`Recording: ${names[which]}`)
      intro()
    })
    intro()

    ctx.primary('Record', () =>
      once(async () => {
        const name = names[which]
        const { phases } = RECORDINGS[name]
        const h = c.read()
        if (!h || !h.calibrated || h.angle === null) {
          ctx.status('The compass needs calibrating first. Open the Compass app on the watch and follow its prompt, then come back and press Record.')
          return
        }
        for (let s = 3; s > 0; s--) {
          ctx.status(`Get ready: ${phases[0][1]}\n\nStarting in ${s}…`)
          await sleep(1000)
          if (!ctx.alive()) return
        }

        const rows = [] // [ms, heading12 x10 (-1 = none), calibrated, ax, ay, az, gx, gy, gz]
        const perPhase = phases.map(() => [])
        const t0 = Date.now()
        for (let p = 0; p < phases.length; p++) {
          ctx.status(`${p + 1}/${phases.length}  ${phases[p][1]}`)
          const phaseStart = Date.now()
          buzzes(p + 1)
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
        haptics.long()

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
        ctx.status(`${name}\n${lines.join('\n')}`)
        ctx.primary('Record again')
        ctx.log({ recording: name, phases: summary, raw: { columns: 'ms,heading12x10,calibrated,ax,ay,az,gx,gy,gz', rows } })
      }),
    )
  },
}
