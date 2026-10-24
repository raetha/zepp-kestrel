// Point: aim at a painted device, then press the select button, tap the
// circle, or do your gesture (flick, snap or tap) to trigger it. The circle
// shows how sure the watch is: grey = arm not ready, amber = aiming, green =
// a device in mind, full colour = locked.
//
// Dimming: on a dimmable light, hold the select button (or a finger on the
// circle) and twist the wrist: thumb up brightens, thumb down dims. Letting go
// sends the change.
//
// Rooms: when the watch knows which room it's in (Bluetooth calibration or a
// Home Assistant sensor), only spots painted in that room (or before rooms
// existed) count.
//
// Instant toggle (settings.dwell): holding the aim locked on a device for a
// few seconds triggers it, with no button or gesture (lib/dwell.js). Locks
// still need a press.
//
// The screen stays on while you're pointing: each time the arm is held out
// (aiming or a device in mind) or something is triggered, the screen gets
// another AWAKE_MS. Lowering the wrist lets it go off as usual.
//
// After a trigger, "Not it?" offers the runner-up for a few seconds: choosing
// it undoes the first action where that's possible, runs the right one, and
// teaches the right device a small spot where you aimed (lib/paint.js).
// Each trigger also sends a short aim trace to Home Assistant (with the probe
// results), so the classifier can be tuned on real data.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { setWakeUpRelaunch, setPageBrightTime, resetPageBrightTime } from '@zos/display'
import { event as uiEvent } from '@zos/ui'
import { text, setText, button, clear, circle, setColor, fit, ask, listenKeys, COLOR, SIZE } from './ui.js'
import { startAim } from './aim.js'
import { paintedDevices, paints, setPaint, gesture, settings } from './store.js'
import { Dwell } from '../lib/dwell.js'
import { syncSoon } from './sync.js'
import { detectRoom } from './room.js'
import { stopScan } from './scan.js'
import { Aimer, STATE } from '../lib/classifier.js'
import { GestureDetector, candidateAt, gestureThresholds } from '../lib/gesture.js'
import { correctionSpot, addCorrection } from '../lib/paint.js'
import { spotsForRoom } from '../lib/rooms.js'
import { dimStep } from '../lib/dim.js'
import { METHOD, nextSeq } from '../lib/protocol.js'
import * as haptics from './haptics.js'

const STATE_COLOR = {
  [STATE.RESTING]: 0x333333,
  [STATE.AIMING]: COLOR.aiming,
  [STATE.CANDIDATE]: 0x1f6b45,
  [STATE.LOCKED]: COLOR.candidate,
}
const DIM_COLOR = 0x5a3fd6
const HISTORY_MS = 4000 // aim kept for gestures, corrections and traces
const CORRECT_MS = 5000 // how long "Not it?" stays up
const HOLD_MS = 450 // holding the button or the circle this long starts dimming
const ROOM_EVERY_MS = 45000 // check the room again this often while pointing
const GESTURE_COOLDOWN_MS = 3000 // after a trigger, gestures are ignored this long (one gesture, one toggle)
const AWAKE_MS = 30000 // screen time from the last aim or trigger
const AWAKE_EVERY_MS = 5000 // renew it at most this often
// Toggling these again undoes a wrong trigger. Scenes, scripts and buttons can't be undone.
const REVERSIBLE = ['light', 'switch', 'fan', 'input_boolean', 'media_player', 'cover']
const VERB = { flick: 'flick', snap: 'snap', tap: 'tap' }

const domainOf = (id) => String(id).split('.')[0]

Page(
  BasePage(
    tracked('point', {
      onInit() {
        this.widgets = []
        this.room = null
        this.loadDevices()
        this.aimer = new Aimer()
        this.last = { state: null, best: null, runnerUp: null }
        this.history = [] // { t, heading, pitch, roll, ready, state, best, runnerUp }
        this.busy = false
        this.alive = true
        this.correctTimer = null
        this.holdTimer = null
        this.dim = null
        this.justDimmed = false
        this.roll = 0
        const g = gesture()
        this.gestureKind = g.kind
        const dw = settings().dwell
        this.dwell = dw.enabled ? new Dwell({ ms: dw.seconds * 1000 }) : null
        this.dwellShown = null
        const th = gestureThresholds(g)
        this.detector = th ? new GestureDetector(th) : null
        this.needsCalibration = g.enabled && !th // e.g. snap chosen in Home Assistant but never calibrated
        // the watch's own buzzes jolt the accelerometer like a snap or tap: ignore them
        this.unbuzz = haptics.onBuzz((ms) => this.detector && this.detector.quiet(Date.now() + ms))
        // Raising the wrist again brings Point back. (By default Zepp OS closes
        // an app about 10 s after the screen goes off and wakes to the watch face.)
        try {
          setWakeUpRelaunch({ relaunch: true })
        } catch (e) {
          // older firmware
        }
        this.awakeAt = 0
        this.keepAwake()
      },

      /** Give the screen another AWAKE_MS (called while aiming and on triggers). */
      keepAwake() {
        const now = Date.now()
        if (now - this.awakeAt < AWAKE_EVERY_MS) return
        this.awakeAt = now
        try {
          setPageBrightTime({ brightTime: AWAKE_MS })
        } catch (e) {
          // not critical
        }
      },

      loadDevices() {
        this.allDevices = paintedDevices()
        this.byId = {}
        for (const d of this.allDevices) this.byId[d.id] = d
        this.applyRoom()
      },

      // Only spots that apply in the current room take part.
      applyRoom() {
        const roomId = this.room ? this.room.id : null
        this.devices = this.allDevices.map((d) => ({ ...d, spots: spotsForRoom(d.spots, roomId) })).filter((d) => d.spots.length)
        if (this.topW) {
          const where = this.room ? `${fit(this.room.name, 14)} · ` : ''
          setText(this.topW, `${where}${this.devices.length} painted`)
        }
      },

      async checkRoom() {
        const r = await detectRoom((m, p, t) => ask(this, m, p, t)).catch(() => null)
        if (!this.alive || !r) return
        const changed = (r.room && r.room.id) !== (this.room && this.room.id)
        this.room = r.room
        if (changed) this.applyRoom()
        // tell Home Assistant (its Room sensor) when the watch placed itself somewhere new
        if (changed && r.room && r.source === 'scan') ask(this, METHOD.ROOM, { here: r.room.id }, 8000).catch(() => null)
      },

      hint(state) {
        if (this.dwell && state === STATE.LOCKED) return 'Hold to trigger'
        if (this.needsCalibration && !this.dwell && state === STATE.RESTING) return `Calibrate your ${this.gestureKind}: More → Gesture`
        if (state === STATE.RESTING) return 'Hold your arm out, still'
        if (state === STATE.AIMING) return 'Aiming…'
        const how = this.detector ? `Press or ${VERB[this.gestureKind] || 'gesture'}` : 'Press'
        return state === STATE.LOCKED ? `Locked: ${how.toLowerCase()}` : `${how} to trigger`
      },

      build() {
        if (!this.allDevices.length) {
          text({ y: 34, h: 44, size: SIZE.title, value: 'Point' })
          text({ x: 60, y: 120, w: 360, h: 200, value: 'Nothing painted yet. Go back and choose Paint a device.' })
          return
        }
        this.ring = circle({ x: 240, y: 240, r: 150, color: STATE_COLOR[STATE.RESTING] })
        this.nameW = text({ x: 95, y: 186, w: 290, h: 84, size: 32, value: '' })
        this.hintW = text({ x: 100, y: 272, w: 280, h: 64, size: SIZE.small, color: 0xe6e6e6, value: this.hint(STATE.RESTING) })
        this.topW = text({ x: 110, y: 34, w: 260, h: 34, size: SIZE.small, color: COLOR.quiet, value: '' })
        this.resultW = text({ x: 90, y: 400, w: 300, h: 40, size: SIZE.small, value: '' })
        this.applyRoom()
        // the circle: tap triggers, hold dims
        for (const w of [this.ring, this.nameW, this.hintW]) {
          w.addEventListener(uiEvent.CLICK_DOWN, () => this.holdStart())
          w.addEventListener(uiEvent.CLICK_UP, () => this.holdEnd() || this.trigger('tap'))
        }
        this.unkeys = listenKeys(() => !this.justDimmed && this.trigger('button'), {
          onSelectPress: () => this.holdStart(),
          onSelectRelease: () => this.holdEnd(),
        })
        this.aim = startAim((a) => this.onAim(a), {
          onGyro: (t, dps) => this.detector && this.detector.gyroUpdate(t, dps) && this.onGesture(t),
          onAccel: (t, a) => this.detector && this.detector.accelUpdate(t, a) && this.onGesture(t),
        })
        this.checkRoom()
        this.roomTimer = setInterval(() => this.checkRoom(), ROOM_EVERY_MS)
      },

      onAim(a) {
        this.roll = a.roll
        if (this.dim) return this.onDim(a)
        const r = this.aimer.update(a.t, a.ready, this.devices, a.heading, a.pitch)
        if (r.state !== STATE.RESTING) this.keepAwake()
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
        if (this.dwell && this.onDwell(a, r)) return
        const bestId = r.best ? r.best.id : null
        if (r.state === this.last.state && bestId === (this.last.best && this.last.best.id)) {
          this.last = r
          return
        }
        this.last = r
        setColor(this.ring, STATE_COLOR[r.state])
        setText(this.nameW, r.best ? fit(this.byId[r.best.id].name, 16) : '')
        const hint = this.dwellShown !== null && this.dwellShown !== undefined ? `Hold… ${this.dwellShown}` : this.hint(r.state)
        setText(this.hintW, a.calibrated ? hint : 'Compass: turn the watch in a circle')
        if (r.state === STATE.LOCKED) haptics.sent()
      },

      /** Instant toggle: count down while locked; returns true when it fired. */
      onDwell(a, r) {
        const lockedId = r.state === STATE.LOCKED && r.best ? r.best.id : null
        const d = this.dwell.update(a.t, this.busy ? null : lockedId)
        if (d.fire) {
          this.dwellShown = null
          if (domainOf(d.fire) === 'lock') {
            setText(this.hintW, 'Locks need a press')
            return false
          }
          this.last = r
          this.trigger('dwell', d.fire, this.history[this.history.length - 1] || null)
          return true
        }
        // show the countdown in whole seconds while holding
        const left = d.id && d.progress > 0 ? Math.ceil((1 - d.progress) * this.dwell.o.ms / 1000) : null
        if (left !== this.dwellShown) {
          this.dwellShown = left
          if (left !== null && domainOf(d.id) !== 'lock') setText(this.hintW, `Hold… ${left}`)
          else if (left === null && this.last.state) setText(this.hintW, this.hint(this.last.state))
        }
        return false
      },

      // A gesture moves the arm, so act on what the aim had in mind just before it.
      onGesture(t) {
        if (this.dim) return
        const at = this.detector.startedAt || t
        const cands = this.history.filter((h) => h.state === STATE.CANDIDATE || h.state === STATE.LOCKED).map((h) => ({ t: h.t, id: h.best }))
        const id = candidateAt(cands, at)
        if (!id) return // a gesture with nothing in mind is just movement
        const h = [...this.history].reverse().find((x) => x.t <= at && x.best === id)
        this.trigger(this.gestureKind, id, h)
      },

      // ------------------------------------------------------------ dimming
      holdStart() {
        if (this.busy || this.confirming || this.dim) return
        clearTimeout(this.holdTimer)
        this.holdTimer = setTimeout(() => this.startDim(), HOLD_MS)
      },

      /** Returns true if the hold was a dim (so the release isn't also a tap). */
      holdEnd() {
        clearTimeout(this.holdTimer)
        this.holdTimer = null
        if (!this.dim) return false
        this.finishDim()
        return true
      },

      startDim() {
        const { state, best } = this.last
        if (!best || (state !== STATE.CANDIDATE && state !== STATE.LOCKED)) return
        const d = this.byId[best.id]
        if (!d || !(d.dimmable || domainOf(d.id) === 'light')) return
        const at = this.history[this.history.length - 1] || null
        this.dim = { id: d.id, roll0: this.roll, step: 0, at }
        haptics.sent()
        setColor(this.ring, DIM_COLOR)
        setText(this.nameW, fit(d.name, 16))
        setText(this.hintW, 'Twist: thumb up brighter')
      },

      onDim(a) {
        const step = dimStep(this.dim.roll0, a.roll)
        if (step === this.dim.step) return
        if (Math.floor(Math.abs(step) / 10) !== Math.floor(Math.abs(this.dim.step) / 10)) haptics.sent()
        this.dim.step = step
        setText(this.hintW, step ? `${step > 0 ? '+' : ''}${step}%` : 'Twist: thumb up brighter')
      },

      finishDim() {
        const { id, step, at } = this.dim
        this.dim = null
        this.justDimmed = true
        setTimeout(() => {
          this.justDimmed = false
        }, 600)
        this.last = { state: null, best: null, runnerUp: null }
        if (step) this.fire(id, false, { via: 'dim', action: 'dim', value: step, at })
        else setText(this.hintW, this.hint(STATE.RESTING))
      },

      // ------------------------------------------------------------ triggering
      /** via: button | tap | flick | snap | dim. For gestures, id and the aim at the time are given. */
      trigger(via, id = null, at = null) {
        if (this.busy || this.confirming || this.dim) return
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
        if (this.dwell) this.dwell.triggered(id) // one trigger per hold, however it happened
        this.fire(id, false, { via, at, runnerUp: at ? at.runnerUp : null })
      },

      fire(id, confirmed, ctx = {}) {
        const d = this.byId[id] || { name: id }
        const action = ctx.action || 'toggle'
        this.awakeAt = 0
        this.keepAwake()
        // one gesture, one toggle: the arm settling and the buzzes that follow must not trigger again
        if (this.detector) this.detector.quiet(Date.now() + GESTURE_COOLDOWN_MS)
        this.busy = true
        haptics.sent()
        setText(this.resultW, `${fit(d.name, 14)}${action === 'dim' ? ` ${ctx.value > 0 ? '+' : ''}${ctx.value}%` : ''}…`)
        const t0 = Date.now()
        const room = this.room ? this.room.id : null
        ask(this, METHOD.FIRE, { seq: nextSeq(), target: id, action, value: ctx.value, confirmed, via: ctx.via, room }, 10000)
          .then((r) => {
            this.busy = false
            if (!this.alive) return
            if (r && r.needsConfirm) return this.askConfirm(id, ctx)
            if (r && r.ok) {
              haptics.done()
              const shown = r.brightness !== undefined && r.state === 'on' ? `${r.brightness}%` : r.state || 'done'
              setText(this.resultW, `${fit(d.name, 14)}: ${shown}`)
              if (ctx.runnerUp && ctx.runnerUp !== id && !ctx.correcting && action === 'toggle') this.offerCorrection(id, ctx)
            } else {
              haptics.failed()
              setText(this.resultW, fit((r && r.error) || 'Failed', 34))
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
          h: 56,
          size: SIZE.small,
          label: `Not it? ${fit(other.name, 13)}`,
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
        // teach the right device where the arm actually was (in this room)
        if (ctx.at && ctx.at.heading !== null) {
          const spot = correctionSpot(ctx.at.heading, ctx.at.pitch)
          if (spot && this.room) spot.room = this.room.id
          setPaint(rightId, addCorrection(paints()[rightId], spot))
          syncSoon((m, p, t) => ask(this, m, p, t), 'paints')
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
          button({ x: 90, w: 145, y: 330, h: 58, size: SIZE.body, label: 'Cancel', onClick: done }),
          button({
            x: 245,
            w: 145,
            y: 330,
            h: 58,
            size: SIZE.body,
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
        ask(
          this,
          METHOD.PROBE_LOG,
          {
            test: 'point',
            at: Date.now(),
            via: ctx.via || null,
            action: ctx.action || 'toggle',
            value: ctx.value === undefined ? null : ctx.value,
            target: id,
            runnerUp: ctx.runnerUp || null,
            correctedFrom: ctx.correctedFrom || null,
            room: this.room ? this.room.id : null,
            ok: !!(r && r.ok),
            error: (r && r.error) || null,
            ms,
            columns: 'ms,heading,pitch,roll,ready,state,best',
            trace,
          },
          15000,
        ).catch(() => null)
      },

      onDestroy() {
        this.alive = false
        this.clearCorrection()
        clearTimeout(this.holdTimer)
        clearInterval(this.roomTimer)
        stopScan()
        if (this.aim) this.aim.stop()
        this.unkeys && this.unkeys()
        this.unbuzz && this.unbuzz()
        try {
          setWakeUpRelaunch({ relaunch: false })
          resetPageBrightTime()
        } catch (e) {
          // older firmware
        }
      },
    }),
  ),
)
