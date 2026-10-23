// Point: aim at a painted device and press the select button (or tap the
// circle) to trigger it. The circle shows how sure the watch is:
// grey = arm not ready, amber = aiming, green = a device in mind, full colour = locked.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { setWakeUpRelaunch } from '@zos/display'
import { event as uiEvent } from '@zos/ui'
import { text, setText, button, clear, circle, setColor, fit, ask, listenKeys, COLOR } from './ui.js'
import { startAim } from './aim.js'
import { paintedDevices } from './store.js'
import { Aimer, STATE } from '../lib/classifier.js'
import { METHOD, nextSeq } from '../lib/protocol.js'
import * as haptics from './haptics.js'

const STATE_COLOR = {
  [STATE.RESTING]: 0x333333,
  [STATE.AIMING]: COLOR.aiming,
  [STATE.CANDIDATE]: 0x1f6b45,
  [STATE.LOCKED]: COLOR.candidate,
}
const STATE_HINT = {
  [STATE.RESTING]: 'Hold your arm out, still',
  [STATE.AIMING]: 'Aiming…',
  [STATE.CANDIDATE]: 'Press to trigger',
  [STATE.LOCKED]: 'Locked: press to trigger',
}

Page(
  BasePage(
    tracked('point', {
      onInit() {
        this.widgets = []
        this.devices = paintedDevices()
        this.byId = {}
        for (const d of this.devices) this.byId[d.id] = d
        this.aimer = new Aimer()
        this.last = { state: null, best: null }
        this.busy = false
        // Raising the wrist again brings Point back. (By default Zepp OS closes
        // an app about 10 s after the screen goes off and wakes to the watch face.)
        try {
          setWakeUpRelaunch({ relaunch: true })
        } catch (e) {
          // older firmware
        }
      },

      build() {
        if (!this.devices.length) {
          text({ y: 34, h: 40, size: 28, value: 'Point' })
          text({ x: 60, y: 120, w: 360, h: 200, size: 22, value: 'Nothing painted yet. Go back and choose Paint a device.' })
          return
        }
        this.ring = circle({ x: 240, y: 240, r: 150, color: STATE_COLOR[STATE.RESTING] })
        this.nameW = text({ x: 100, y: 200, w: 280, h: 50, size: 30, value: '' })
        this.hintW = text({ x: 100, y: 252, w: 280, h: 60, size: 20, color: 0xdddddd, value: STATE_HINT[STATE.RESTING] })
        this.topW = text({ y: 40, h: 34, size: 20, color: COLOR.quiet, value: `${this.devices.length} painted` })
        this.resultW = text({ x: 80, y: 404, w: 320, h: 40, size: 20, value: '' })
        // tapping the circle (or its labels) triggers too
        for (const w of [this.ring, this.nameW, this.hintW]) w.addEventListener(uiEvent.CLICK_UP, () => this.trigger())

        this.unkeys = listenKeys(() => this.trigger())

        this.aim = startAim((a) => this.onAim(a))
      },

      onAim(a) {
        if (this.confirming) return
        const r = this.aimer.update(a.t, a.ready, this.devices, a.heading, a.pitch)
        const bestId = r.best ? r.best.id : null
        if (r.state === this.last.state && bestId === (this.last.best && this.last.best.id)) {
          this.last = r
          return
        }
        this.last = r
        setColor(this.ring, STATE_COLOR[r.state])
        setText(this.nameW, r.best ? fit(this.byId[r.best.id].name, 16) : '')
        setText(this.hintW, a.calibrated ? STATE_HINT[r.state] : 'Calibrate the compass')
        if (r.state === STATE.LOCKED) haptics.sent()
      },

      trigger() {
        const { state, best } = this.last
        if (this.busy || this.confirming) return
        if (!best || (state !== STATE.CANDIDATE && state !== STATE.LOCKED)) {
          haptics.failed()
          setText(this.resultW, 'Point at a painted device first')
          return
        }
        this.fire(best.id, false)
      },

      fire(id, confirmed) {
        const d = this.byId[id]
        this.busy = true
        haptics.sent()
        setText(this.resultW, `${fit(d.name, 14)}…`)
        ask(this, METHOD.FIRE, { seq: nextSeq(), target: id, action: 'toggle', confirmed }, 10000)
          .then((r) => {
            this.busy = false
            if (r && r.needsConfirm) return this.askConfirm(id)
            if (r && r.ok) {
              haptics.done()
              setText(this.resultW, `${fit(d.name, 14)}: ${r.state || 'done'}`)
            } else {
              haptics.failed()
              setText(this.resultW, fit((r && r.error) || 'Failed', 30))
            }
          })
          .catch(() => {
            this.busy = false
            haptics.failed()
            setText(this.resultW, 'Phone not reachable')
          })
      },

      // Locks never act on a gesture alone: ask for a deliberate tap.
      askConfirm(id) {
        const d = this.byId[id]
        this.confirming = true
        setColor(this.ring, 0x7a2a2a)
        setText(this.nameW, fit(d.name, 16))
        setText(this.hintW, 'Confirm?')
        setText(this.resultW, '')
        const done = () => {
          clear(this.widgets)
          this.confirming = false
          this.last = { state: null, best: null }
        }
        this.widgets.push(
          button({ x: 100, w: 130, y: 330, h: 56, size: 22, label: 'Cancel', onClick: done }),
          button({ x: 250, w: 130, y: 330, h: 56, size: 22, label: 'Confirm', primary: true, onClick: () => { done(); this.fire(id, true) } }),
        )
      },

      onDestroy() {
        if (this.aim) this.aim.stop()
        this.unkeys && this.unkeys()
        try {
          setWakeUpRelaunch({ relaunch: false })
        } catch (e) {
          // older firmware
        }
      },
    }),
  ),
)
