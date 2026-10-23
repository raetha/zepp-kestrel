// Point: aim at a painted device, then press the select button, tap the
// circle, or flick your wrist to trigger it. The circle shows how sure the
// watch is: grey = arm not ready, amber = aiming, green = a device in mind,
// full colour = locked.
//
// After a trigger, "Not it?" offers the runner-up for a few seconds: choosing
// it undoes the first action where that's possible, runs the right one, and
// teaches the right device a small spot where you aimed (lib/paint.js).
// Each trigger also sends a short aim trace to Home Assistant (with the probe
// results), so the classifier can be tuned on real data.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { setWakeUpRelaunch } from '@zos/display'
import { event as uiEvent } from '@zos/ui'
import { text, setText, button, clear, circle, setColor, fit, ask, listenKeys, COLOR } from './ui.js'
import { startAim } from './aim.js'
import { paintedDevices, paints, savePaints, backupPaints, flickSettings } from './store.js'
import { Aimer, STATE } from '../lib/classifier.js'
import { FlickDetector, candidateAt } from '../lib/flick.js'
import { correctionSpot, addCorrection } from '../lib/paint.js'
import { METHOD, nextSeq } from '../lib/protocol.js'
import * as haptics from './haptics.js'

const STATE_COLOR = {
  [STATE.RESTING]: 0x333333,
  [STATE.AIMING]: COLOR.aiming,
  [STATE.CANDIDATE]: 0x1f6b45,
  [STATE.LOCKED]: COLOR.candidate,
}
const HISTORY_MS = 4000 // aim kept for flicks, corrections and traces
const CORRECT_MS = 5000 // how long "Not it?" stays up
// Toggling these again undoes a wrong trigger. Scenes, scripts and buttons can't be undone.
const REVERSIBLE = ['light', 'switch', 'fan', 'input_boolean', 'media_player', 'cover']

const domainOf = (id) => String(id).split('.')[0]

Page(
  BasePage(
    tracked('point', {
      onInit() {
        this.widgets = []
        this.loadDevices()
        this.aimer = new Aimer()
        this.last = { state: null, best: null, runnerUp: null }
        this.history = [] // { t, heading, pitch, roll, ready, state, best, runnerUp }
        this.busy = false
        this.alive = true
        this.correctTimer = null
        const f = flickSettings()
        this.flick = f.enabled ? new FlickDetector({ threshold: f.threshold }) : null
        // Raising the wrist again brings Point back. (By default Zepp OS closes
        // an app about 10 s after the screen goes off and wakes to the watch face.)
        try {
          setWakeUpRelaunch({ relaunch: true })
        } catch (e) {
          // older firmware
        }
      },

      loadDevices() {
        this.devices = paintedDevices()
        this.byId = {}
        for (const d of this.devices) this.byId[d.id] = d
      },

      hint(state) {
        if (state === STATE.RESTING) return 'Hold your arm out, still'
        if (state === STATE.AIMING) return 'Aiming…'
        const how = this.flick ? 'Press or flick' : 'Press'
        return state === STATE.LOCKED ? `Locked: ${how.toLowerCase()}` : `${how} to trigger`
      },

      build() {
        if (!this.devices.length) {
          text({ y: 34, h: 40, size: 28, value: 'Point' })
          text({ x: 60, y: 120, w: 360, h: 200, size: 22, value: 'Nothing painted yet. Go back and choose Paint a device.' })
          return
        }
        this.ring = circle({ x: 240, y: 240, r: 150, color: STATE_COLOR[STATE.RESTING] })
        this.nameW = text({ x: 100, y: 200, w: 280, h: 50, size: 30, value: '' })
        this.hintW = text({ x: 100, y: 252, w: 280, h: 60, size: 20, color: 0xdddddd, value: this.hint(STATE.RESTING) })
        this.topW = text({ y: 40, h: 34, size: 20, color: COLOR.quiet, value: `${this.devices.length} painted` })
        this.resultW = text({ x: 80, y: 404, w: 320, h: 40, size: 20, value: '' })
        // tapping the circle (or its labels) triggers too
        for (const w of [this.ring, this.nameW, this.hintW]) w.addEventListener(uiEvent.CLICK_UP, () => this.trigger('tap'))

        this.unkeys = listenKeys(() => this.trigger('button'))
        this.aim = startAim((a) => this.onAim(a), { onGyro: (t, dps) => this.onGyro(t, dps) })
      },

      onAim(a) {
        const r = this.aimer.update(a.t, a.ready, this.devices, a.heading, a.pitch)
        this.history.push({
          t: a.t,
          heading: a.heading,
          pitch: a.pitch,
          roll: a.roll,
          ready: a.ready,
          state: r.state,
          best: r.best ? r.best.id : null,
          runnerUp: r.runnerUp ? r.runnerUp.id : null,
        })
        while (this.history.length && a.t - this.history[0].t > HISTORY_MS) this.history.shift()
        if (this.confirming) return
        const bestId = r.best ? r.best.id : null
        if (r.state === this.last.state && bestId === (this.last.best && this.last.best.id)) {
          this.last = r
          return
        }
        this.last = r
        setColor(this.ring, STATE_COLOR[r.state])
        setText(this.nameW, r.best ? fit(this.byId[r.best.id].name, 16) : '')
        setText(this.hintW, a.calibrated ? this.hint(r.state) : 'Calibrate the compass')
        if (r.state === STATE.LOCKED) haptics.sent()
      },

      // A flick moves the arm, so act on what the aim had in mind just before it.
      onGyro(t, dps) {
        if (!this.flick || !this.flick.update(t, dps)) return
        const at = this.flick.startedAt || t
        const cands = this.history.filter((h) => h.state === STATE.CANDIDATE || h.state === STATE.LOCKED).map((h) => ({ t: h.t, id: h.best }))
        const id = candidateAt(cands, at)
        if (!id) return // a flick with nothing in mind is just movement
        const h = [...this.history].reverse().find((x) => x.t <= at && x.best === id)
        this.trigger('flick', id, h)
      },

      /** via: button | tap | flick. For flicks, id and the aim at the time are given. */
      trigger(via, id = null, at = null) {
        if (this.busy || this.confirming) return
        if (!id) {
          const { state, best } = this.last
          if (!best || (state !== STATE.CANDIDATE && state !== STATE.LOCKED)) {
            haptics.failed()
            setText(this.resultW, 'Point at a painted device first')
            return
          }
          id = best.id
          at = this.history[this.history.length - 1] || null
        }
        this.clearCorrection()
        this.fire(id, false, { via, at, runnerUp: at ? at.runnerUp : null })
      },

      fire(id, confirmed, ctx = {}) {
        const d = this.byId[id] || { name: id }
        this.busy = true
        haptics.sent()
        setText(this.resultW, `${fit(d.name, 14)}…`)
        const t0 = Date.now()
        ask(this, METHOD.FIRE, { seq: nextSeq(), target: id, action: 'toggle', confirmed }, 10000)
          .then((r) => {
            this.busy = false
            if (!this.alive) return
            if (r && r.needsConfirm) return this.askConfirm(id, ctx)
            if (r && r.ok) {
              haptics.done()
              setText(this.resultW, `${fit(d.name, 14)}: ${r.state || 'done'}`)
              if (ctx.runnerUp && ctx.runnerUp !== id && !ctx.correcting) this.offerCorrection(id, ctx)
            } else {
              haptics.failed()
              setText(this.resultW, fit((r && r.error) || 'Failed', 30))
            }
            this.record(id, ctx, r, Date.now() - t0)
          })
          .catch(() => {
            this.busy = false
            if (!this.alive) return
            haptics.failed()
            setText(this.resultW, 'Phone not reachable')
          })
      },

      // ------------------------------------------------------------ corrections
      offerCorrection(firedId, ctx) {
        const other = this.byId[ctx.runnerUp]
        if (!other) return
        this.correctW = button({
          x: 90,
          w: 300,
          y: 330,
          h: 54,
          size: 21,
          label: `Not it? ${fit(other.name, 14)}`,
          onClick: () => this.correct(firedId, ctx),
        })
        this.correctTimer = setTimeout(() => this.clearCorrection(), CORRECT_MS)
      },

      clearCorrection() {
        if (this.correctTimer) clearTimeout(this.correctTimer)
        this.correctTimer = null
        if (this.correctW) clear([this.correctW])
        this.correctW = null
      },

      correct(wrongId, ctx) {
        const rightId = ctx.runnerUp
        this.clearCorrection()
        // undo the wrong one where a second toggle puts it back
        if (REVERSIBLE.includes(domainOf(wrongId))) {
          ask(this, METHOD.FIRE, { seq: nextSeq(), target: wrongId, action: 'toggle', confirmed: false }, 10000).catch(() => null)
        }
        // teach the right device where the arm actually was
        if (ctx.at && ctx.at.heading !== null) {
          const p = paints()
          p[rightId] = addCorrection(p[rightId], correctionSpot(ctx.at.heading, ctx.at.pitch))
          savePaints(p)
          backupPaints((m, params) => ask(this, m, params, 15000))
          this.loadDevices()
        }
        this.fire(rightId, false, { ...ctx, correcting: true, correctedFrom: wrongId })
      },

      // Locks never act on a gesture alone: ask for a deliberate tap.
      askConfirm(id, ctx) {
        const d = this.byId[id] || { name: id }
        this.confirming = true
        setColor(this.ring, 0x7a2a2a)
        setText(this.nameW, fit(d.name, 16))
        setText(this.hintW, 'Confirm?')
        setText(this.resultW, '')
        const done = () => {
          clear(this.widgets)
          this.confirming = false
          this.last = { state: null, best: null, runnerUp: null }
        }
        this.widgets.push(
          button({ x: 100, w: 130, y: 330, h: 56, size: 22, label: 'Cancel', onClick: done }),
          button({
            x: 250,
            w: 130,
            y: 330,
            h: 56,
            size: 22,
            label: 'Confirm',
            primary: true,
            onClick: () => {
              done()
              this.fire(id, true, { ...ctx, correcting: true })
            },
          }),
        )
      },

      // ------------------------------------------------------------ aim traces
      // Sent after the action, so it never delays it.
      record(id, ctx, r, ms) {
        const t0 = ctx.at ? ctx.at.t : Date.now()
        const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10)
        const trace = this.history
          .filter((h) => h.t <= t0 + 500)
          .map((h) => [h.t - t0, r1(h.heading), r1(h.pitch), r1(h.roll), h.ready ? 1 : 0, h.state, h.best])
        ask(this, METHOD.PROBE_LOG, {
          test: 'point',
          at: Date.now(),
          via: ctx.via || null,
          target: id,
          runnerUp: ctx.runnerUp || null,
          correctedFrom: ctx.correctedFrom || null,
          ok: !!(r && r.ok),
          ms,
          columns: 'ms,heading,pitch,roll,ready,state,best',
          trace,
        }, 15000).catch(() => null)
      },

      onDestroy() {
        this.alive = false
        this.clearCorrection()
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
