// The gesture trigger: pick a wrist flick, a finger snap or a finger tap,
// calibrate it, or turn it off. Calibration records five gestures and a few
// seconds of ordinary aiming movement, then sets thresholds between them
// (lib/gesture.js). The result goes to Home Assistant (settings, adjustable
// in the integration's options) and, in full, with the probe results.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { text, setText, button, setLabel, ask, listenKeys, COLOR } from './ui.js'
import { accel, gyro } from './sensors.js'
import { gesture, setGesture } from './store.js'
import { sync } from './sync.js'
import { calibrateGesture, peakRate, peakJolt } from '../lib/gesture.js'
import { METHOD } from '../lib/protocol.js'
import * as haptics from './haptics.js'

const KINDS = ['flick', 'snap', 'tap']
const LABEL = { flick: 'Wrist flick', snap: 'Finger snap', tap: 'Finger tap' }
const HOW = {
  flick: 'flick your wrist once',
  snap: 'snap your fingers once',
  tap: 'tap your thumb and finger together once',
}
const COUNT = 5
const WINDOW_MS = 1500
const MOVEMENT_MS = 8000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function describe(g) {
  if (!g.enabled) return `Gesture trigger is off.\n\nOn Point, press the select button or tap the circle instead.`
  const t = [g.gyro ? `turn over ${g.gyro}°/s` : null, g.jolt ? `jolt over ${g.jolt}` : null].filter(Boolean).join(' or ')
  return `${LABEL[g.kind] || g.kind}: ${g.calibrated ? 'calibrated' : 'standard setting'} (${t || 'no threshold'}).\n\nOn Point, aim, then ${HOW[g.kind] || 'do the gesture'} to trigger.`
}

Page(
  BasePage(
    tracked('gesture', {
      onInit() {
        this.alive = true
        this.busy = false
        this.awake = false
        this.kind = gesture().kind || 'flick'
      },

      build() {
        this.unkeys = listenKeys(() => this.calibrate())
        text({ y: 30, h: 40, size: 28, value: 'Gesture' })
        this.bodyW = text({ x: 56, y: 76, w: 368, h: 186, size: 20, value: '' })
        this.kindW = button({ x: 90, y: 268, w: 300, h: 50, size: 21, label: '', onClick: () => this.nextKind() })
        this.toggleW = button({ x: 90, y: 326, w: 300, h: 50, size: 21, label: '', onClick: () => this.toggle() })
        this.calW = button({ x: 120, y: 388, w: 240, h: 56, label: 'Calibrate', primary: true, onClick: () => this.calibrate() })
        this.show()
      },

      show() {
        const g = gesture()
        setText(this.bodyW, describe(g))
        setLabel(this.kindW, `Gesture: ${LABEL[this.kind]}`)
        setLabel(this.toggleW, g.enabled ? 'Turn off' : 'Turn on')
      },

      push() {
        sync((m, p, t) => ask(this, m, p, t), ['paints']).catch(() => null) // sends the gesture first
      },

      nextKind() {
        if (this.busy) return
        this.kind = KINDS[(KINDS.indexOf(this.kind) + 1) % KINDS.length]
        setLabel(this.kindW, `Gesture: ${LABEL[this.kind]}`)
        setText(this.bodyW, `Calibrate to use ${LABEL[this.kind].toLowerCase()}: it needs to learn yours.`)
      },

      toggle() {
        if (this.busy) return
        setGesture({ enabled: !gesture().enabled })
        this.push()
        this.show()
      },

      keepAwake(on) {
        this.awake = on
        try {
          if (on) pauseDropWristScreenOff({ duration: 0 })
          else resetDropWristScreenOff()
        } catch (e) {
          // not critical
        }
      },

      async calibrate() {
        if (this.busy) return
        this.busy = true
        this.keepAwake(true)
        const kind = this.kind
        const g = gyro()
        const a = accel()
        let gBuf = []
        let aBuf = []
        g.start('NORMAL', (s) => gBuf.push(s))
        a.start('NORMAL', (s) => aBuf.push(s))
        try {
          setText(this.bodyW, `Hold your arm out as if pointing at something.\n\nAfter each buzz, ${HOW[kind]}. ${COUNT} times.`)
          await sleep(3500)
          const peaks = []
          for (let i = 0; i < COUNT; i++) {
            if (!this.alive) return
            gBuf = []
            aBuf = []
            haptics.sent()
            setText(this.bodyW, `${i + 1} of ${COUNT}: now!`)
            await sleep(WINDOW_MS)
            peaks.push({ gyro: Math.round(peakRate(gBuf)), jolt: Math.round(peakJolt(aBuf)) })
            setText(this.bodyW, `${i + 1}: turn ${peaks[i].gyro}°/s, jolt ${peaks[i].jolt}`)
            await sleep(800)
          }
          if (!this.alive) return
          haptics.done()
          setText(this.bodyW, `Now point around slowly at a few things for ${MOVEMENT_MS / 1000} s, the way you aim. No ${LABEL[kind].toLowerCase()}s.`)
          await sleep(3000)
          if (!this.alive) return
          haptics.sent()
          gBuf = []
          aBuf = []
          setText(this.bodyW, 'Pointing around…')
          await sleep(MOVEMENT_MS)
          if (!this.alive) return
          const movement = { gyro: Math.round(peakRate(gBuf)), jolt: Math.round(peakJolt(aBuf)) }
          haptics.long()

          const c = calibrateGesture(peaks, movement)
          if (c.ok) {
            setGesture({ enabled: true, kind, gyro: c.gyro, jolt: c.jolt, calibrated: true })
            this.push()
          }
          const yours = `Yours: turn ${peaks.map((p) => p.gyro).join(', ')}°/s; jolt ${peaks.map((p) => p.jolt).join(', ')}\nAiming: turn ${movement.gyro}°/s, jolt ${movement.jolt}`
          setText(this.bodyW, c.ok ? `Calibrated.\n${yours}` : `Not calibrated: ${c.reason}.\n${yours}\nTry sharper ${LABEL[kind].toLowerCase()}s.`)
          setLabel(this.calW, 'Again')
          setLabel(this.toggleW, gesture().enabled ? 'Turn off' : 'Turn on')
          ask(this, METHOD.PROBE_LOG, { test: 'gesture', at: Date.now(), kind, peaks, movement, ...c }, 15000).catch(() => null)
        } finally {
          g.stop()
          a.stop()
          this.busy = false
          this.keepAwake(false)
        }
      },

      onDestroy() {
        this.alive = false
        this.unkeys && this.unkeys()
        if (this.awake) this.keepAwake(false)
      },
    }),
  ),
)
