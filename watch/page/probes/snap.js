// Record 2-second windows of accelerometer + gyro around a gesture, so we
// can see whether a snap (or tap, or flick) leaves a detectable spike at the
// rate the watch actually delivers. Raw samples go to the phone for replay.

import { accel, gyro } from '../sensors.js'
import { analyzeSpike } from '../../lib/spike.js'
import { mag } from '../../lib/aim.js'
import { sleep, guard, cycler, r1 } from './util.js'
import { Vibrator } from '@zos/sensor'

const BUFFER_MS = 4000
const WINDOW_MS = 2000
const GESTURES = ['snap', 'finger tap', 'wrist flick', 'arm wave', 'nothing']

export const snapProbe = {
  title: 'Snap recorder',
  start(ctx) {
    const once = guard()
    const aBuf = []
    const gBuf = []
    const trim = (buf, now) => {
      while (buf.length && now - buf[0].t > BUFFER_MS) buf.shift()
    }

    const a = accel()
    const g = gyro()
    a.start('HIGH', (s) => {
      aBuf.push(s)
      trim(aBuf, s.t)
    })
    g.start('HIGH', (s) => {
      gBuf.push(s)
      trim(gBuf, s.t)
    })
    ctx.onCleanup(() => {
      a.stop()
      g.stop()
    })

    let vib = null
    try {
      vib = new Vibrator()
    } catch (e) {
      vib = null
    }
    const buzz = () => {
      try {
        vib && vib.start()
      } catch (e) {
        // haptics are a nicety here
      }
    }

    const gesture = cycler(ctx, 'Gesture', GESTURES)
    let count = 0
    const history = []

    ctx.status('Hold your arm out as if pointing.\n\nPress Record (or the select button), wait for the buzz, then do the gesture once.')
    ctx.primary('Record', () =>
      once(async () => {
        for (let s = 3; s > 0; s--) {
          ctx.status(`${gesture()} in ${s}…`)
          await sleep(700)
          if (!ctx.alive()) return
        }
        buzz()
        ctx.status(`Now: ${gesture()}!`)
        const t0 = Date.now()
        await sleep(WINDOW_MS)
        if (!ctx.alive()) return
        const aw = aBuf.filter((s) => s.t >= t0)
        const gw = gBuf.filter((s) => s.t >= t0)

        const spike = analyzeSpike(aw)
        const gyroPeak = gw.reduce((m, s) => Math.max(m, mag(s.x, s.y, s.z)), 0)
        count++
        const line = `#${count} ${gesture()}: ${spike.hz} Hz, peak ${spike.peakDev}, ${spike.widthMs} ms, gyro ${Math.round(gyroPeak)}°/s`
        history.unshift(line)
        ctx.status(history.slice(0, 5).join('\n'))

        ctx.log({
          gesture: gesture(),
          ...spike,
          gyroPeak: Math.round(gyroPeak),
          gyroHz: gw.length > 1 ? r1(((gw.length - 1) / (gw[gw.length - 1].t - gw[0].t)) * 1000) : 0,
          // Compact raw trace: [ms since t0, x, y, z] as integers.
          raw: {
            accel: aw.map((s) => [s.t - t0, Math.round(s.x), Math.round(s.y), Math.round(s.z)]),
            gyro: gw.map((s) => [s.t - t0, Math.round(s.x), Math.round(s.y), Math.round(s.z)]),
          },
        })
      }),
    )
  },
}
