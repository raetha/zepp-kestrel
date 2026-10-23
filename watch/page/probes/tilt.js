// Does the compass heading stay put when you point at the same spot with
// your wrist rotated differently? And how noisy is it indoors?
// Each capture averages 2 s of headings (circular mean) and reports spread.

import { accel, compass } from '../sensors.js'
import { pitchRoll } from '../../lib/aim.js'
import { circularMean, angleDiff } from '../../../lib/circular.js'
import { mean } from '../../../lib/stats.js'
import { sleep, guard, cycler, r1 } from './util.js'

const POSES = ['palm down', 'thumb up', 'palm up', 'arm raised', 'arm lowered']
const CAPTURE_MS = 2000
const SAMPLE_MS = 100

export const tiltProbe = {
  title: 'Compass tilt',
  start(ctx) {
    const once = guard()
    let lastA = null
    const a = accel()
    const c = compass()
    a.start('NORMAL', (s) => {
      lastA = s
    })
    c.start(null, () => {})

    const read = () => {
      const h = c.read()
      const pr = lastA ? pitchRoll(lastA.x, lastA.y, lastA.z) : null
      return { h, pr }
    }

    const pose = cycler(ctx, 'Pose', POSES)
    const captures = []
    let capturing = false

    const live = setInterval(() => {
      if (capturing) return
      const { h, pr } = read()
      const head = h && h.angle !== null ? `${Math.round(h.angle)}°` : 'not calibrated'
      const att = pr ? `pitch ${Math.round(pr.pitch)}°  roll ${Math.round(pr.roll)}°` : '…'
      const list = captures
        .slice(-4)
        .map((k) => `${k.pose}: ${k.heading}° ±${k.spread}${k.delta === null ? '' : `  Δ${k.delta > 0 ? '+' : ''}${k.delta}`}`)
        .join('\n')
      ctx.status(`Heading ${head}\n${att}\n\n${list || 'Point at one fixed spot for every capture.'}`)
    }, 250)

    ctx.onCleanup(() => {
      clearInterval(live)
      a.stop()
      c.stop()
    })

    ctx.primary('Capture', () =>
      once(async () => {
        capturing = true
        ctx.status(`Hold still: ${pose()}…`)
        const heads = []
        const pitches = []
        const rolls = []
        const end = Date.now() + CAPTURE_MS
        while (Date.now() < end) {
          const { h, pr } = read()
          if (h && h.angle !== null) heads.push(h.angle)
          if (pr) {
            pitches.push(pr.pitch)
            rolls.push(pr.roll)
          }
          await sleep(SAMPLE_MS)
        }
        capturing = false
        const m = circularMean(heads)
        if (!m) {
          ctx.status('No valid headings. Calibrate the compass (open the Compass app and follow its prompt), then try again.')
          return
        }
        const first = captures[0]
        const cap = {
          pose: pose(),
          heading: r1(m.mean),
          spread: r1(m.spread),
          pitch: r1(mean(pitches) || 0),
          roll: r1(mean(rolls) || 0),
          samples: heads.length,
          delta: first ? r1(angleDiff(m.mean, first.heading)) : null,
        }
        captures.push(cap)
        ctx.log(cap)
      }),
    )
  },
}
