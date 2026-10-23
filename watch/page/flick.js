// Flick to trigger: turn it on or off, and calibrate it to your flick.
// Calibration records five flicks and ten seconds of ordinary movement, then
// sets the gyro threshold between them (lib/flick.js, calibrateFlick). The
// result also goes to Home Assistant with the probe results.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { text, setText, button, setLabel, ask, listenKeys, COLOR } from './ui.js'
import { gyro } from './sensors.js'
import { flickSettings, saveFlickSettings } from './store.js'
import { calibrateFlick, peakRate } from '../lib/flick.js'
import { METHOD } from '../lib/protocol.js'
import * as haptics from './haptics.js'

const FLICKS = 5
const FLICK_WINDOW_MS = 1500
const MOVEMENT_MS = 10000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function describe(f) {
  if (!f.enabled) return 'Flick to trigger is off. Press the select button or tap the circle on Point instead.'
  return f.calibrated
    ? `On, calibrated to your flick (${f.threshold}°/s).\n\nOn Point, aim, then flick your wrist to trigger.`
    : `On, with the standard setting (${f.threshold}°/s). Calibrate to fit your flick.\n\nOn Point, aim, then flick your wrist to trigger.`
}

Page(
  BasePage(
    tracked('flick', {
      onInit() {
        this.alive = true
        this.busy = false
        this.awake = false
      },

      build() {
        this.unkeys = listenKeys(() => this.calibrate())
        text({ y: 36, h: 40, size: 28, value: 'Flick' })
        this.bodyW = text({ x: 56, y: 86, w: 368, h: 230, size: 21, value: '' })
        this.toggleW = button({ x: 90, y: 330, w: 300, h: 54, size: 22, label: '', onClick: () => this.toggle() })
        this.calW = button({ x: 120, y: 396, w: 240, h: 56, label: 'Calibrate', primary: true, onClick: () => this.calibrate() })
        this.show()
      },

      show() {
        const f = flickSettings()
        setText(this.bodyW, describe(f))
        setLabel(this.toggleW, f.enabled ? 'Turn off' : 'Turn on')
      },

      toggle() {
        if (this.busy) return
        saveFlickSettings({ enabled: !flickSettings().enabled })
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
        const g = gyro()
        let buf = []
        g.start('NORMAL', (s) => buf.push(s))
        try {
          setText(this.bodyW, `Hold your arm out as if pointing.\n\nAfter each buzz, flick your wrist once, the way you'd trigger something. ${FLICKS} times.`)
          await sleep(3000)
          const flicks = []
          for (let i = 0; i < FLICKS; i++) {
            if (!this.alive) return
            buf = []
            haptics.sent()
            setText(this.bodyW, `Flick ${i + 1} of ${FLICKS}: now!`)
            await sleep(FLICK_WINDOW_MS)
            flicks.push(Math.round(peakRate(buf)))
            setText(this.bodyW, `Flick ${i + 1}: ${flicks[i]}°/s`)
            await sleep(700)
          }
          if (!this.alive) return
          haptics.done()
          setText(this.bodyW, `Now move normally for ${MOVEMENT_MS / 1000} s without flicking: wave, turn your hand, reach for something, point around.`)
          await sleep(2500)
          if (!this.alive) return
          haptics.sent()
          buf = []
          setText(this.bodyW, 'Moving normally…')
          await sleep(MOVEMENT_MS)
          if (!this.alive) return
          const movement = Math.round(peakRate(buf))
          haptics.long()

          const c = calibrateFlick(flicks, movement)
          if (c.ok) saveFlickSettings({ enabled: true, threshold: c.threshold, calibrated: true })
          setText(
            this.bodyW,
            c.ok
              ? `Calibrated: triggers above ${c.threshold}°/s.\n\nYour flicks: ${flicks.join(', ')}°/s\nOrdinary movement: up to ${movement}°/s`
              : `Not calibrated: ${c.reason}.\nFlicks: ${flicks.join(', ')}°/s\nMovement: up to ${movement}°/s\n\nTry again with sharper flicks.`,
          )
          setLabel(this.toggleW, flickSettings().enabled ? 'Turn off' : 'Turn on')
          setLabel(this.calW, 'Again')
          ask(this, METHOD.PROBE_LOG, { test: 'flick', at: Date.now(), flicks, movement, ...c }, 15000).catch(() => null)
        } finally {
          g.stop()
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
