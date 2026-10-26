// Point: aim at a painted device, then press the select button, tap the
// screen, or do your gesture (flick, snap or tap) to trigger it.
// The whole screen shows how sure the watch is, readable at arm's length:
// black = arm not ready, dark amber = aiming, dark green = a device in mind,
// bright green = locked (trigger now). After a trigger it flashes green (done)
// or red (failed).
//
// Dimming: on a dimmable light, hold the select button (or a finger on the
// screen) and twist the wrist: thumb up brightens, thumb down dims. Letting go
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
import { tracked, note } from './trail.js'
import { batteryLevel } from './sensors.js'
import { setWakeUpRelaunch, setPageBrightTime, resetPageBrightTime } from '@zos/display'
import { event as uiEvent } from '@zos/ui'
import { text, setText, button, clear, rect, setColor, setTextColor, fit, ask, listenKeys, tickRing, COLOR, SIZE } from './ui.js'
import { Circling } from '../lib/circling.js'
import { startAim } from './aim.js'
import { paintedDevices, paints, setPaint, gesture, settings, rooms, setRoom } from './store.js'
import { Dwell } from '../lib/dwell.js'
import { syncSoon, sync, firstSyncOfRun } from './sync.js'
import { detectRoom } from './room.js'
import { stopScan } from './scan.js'
import { Aimer, STATE } from '../lib/classifier.js'
import { GestureDetector, candidateAt, gestureThresholds } from '../lib/gesture.js'
import { correctionSpot, addCorrection } from '../lib/paint.js'
import { spotsForRoom, OTHER_ROOM_PRIOR } from '../lib/rooms.js'
import { dimStep, volumeStep } from '../lib/dim.js'
import { angleDiff } from '../lib/circular.js'
import { learnSpot, clearMatch, adaptFingerprint, LEARN } from '../lib/learn.js'
import { METHOD, nextSeq } from '../lib/protocol.js'
import * as haptics from './haptics.js'

// [background, text] per state: dark text only on the bright backgrounds
const LOOK = {
  [STATE.RESTING]: [0x000000, 0xffffff],
  [STATE.AIMING]: [0x4a3000, 0xffffff],
  [STATE.CANDIDATE]: [0x0d5a32, 0xffffff],
  [STATE.LOCKED]: [0x3ddc84, 0x000000],
  dim: [0x4b2fb8, 0xffffff],
  done: [0x3ddc84, 0x000000],
  failed: [0xc62828, 0xffffff],
  confirm: [0x7a2a2a, 0xffffff],
}
const FLASH_MS = 1200 // how long the done / failed colour stays
const HISTORY_MS = 4000 // aim kept for gestures, corrections and traces
const CORRECT_MS = 5000 // how long "Not it?" stays up
const HOLD_MS = 450 // holding the button or the screen this long starts dimming
// Twist to dim with no hold: locked on a dimmable light (or a media player's volume), turn the
// wrist slowly. The twist starts once the wrist has turned TWIST_START degrees from where it was
// when the lock began, with the arm still at the same height and the turn slow (a flick is fast);
// it's sent once the wrist has been still for TWIST_SETTLE_MS, or when the arm drops.
const TWIST_START = 20
const TWIST_MAX_DPS = 150
const TWIST_SETTLE_MS = 1000
const TWIST_LOCK_MEMORY_MS = 1500 // the lock may drop as the wrist turns (the compass shifts): remember it this long
const ROOM_LEARN_MS = 10 * 60000 // a room's fingerprint learns from at most one check this often
const ROOM_EVERY_MS = 60000 // check the room again this often while pointing (a 3 s Bluetooth scan)
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
        // sure of the room: other rooms' devices are left out; only just: they count half (lib/rooms.js)
        const prior = this.room && this.room.sure ? 0 : OTHER_ROOM_PRIOR
        this.devices = this.allDevices.map((d) => ({ ...d, spots: spotsForRoom(d.spots, roomId, prior) })).filter((d) => d.spots.length)
        if (this.topW) {
          // a "?" when the room matched only just (other rooms' devices still count, at half)
          const where = this.room ? `${fit(this.room.name, 14)}${this.room.sure ? '' : '?'} · ` : ''
          setText(this.topW, `${where}${this.devices.length} painted`)
        }
      },

      async checkRoom() {
        const r = await detectRoom((m, p, t) => ask(this, m, p, t)).catch(() => null)
        if (!this.alive || !r) return
        const sure = !!r.room && (r.source === 'sensor' || clearMatch(r.ranked))
        const changed = (r.room && r.room.id) !== (this.room && this.room.id) || sure !== !!(this.room && this.room.sure)
        this.room = r.room ? { ...r.room, sure } : null
        if (changed) this.applyRoom()
        this.learnRoom(r)
        // tell Home Assistant (its Room sensor) when the watch placed itself somewhere new
        if (changed && r.room && r.source === 'scan') ask(this, METHOD.ROOM, { here: r.room.id }, 8000).catch(() => null)
      },

      hint(state) {
        if (this.dwell && state === STATE.LOCKED) {
          const spent = this.last.best && this.dwell.spent === this.last.best.id
          return spent ? 'Aim away to repeat' : 'Hold to trigger'
        }
        if (this.needsCalibration && !this.dwell && state === STATE.RESTING) return `Calibrate your ${this.gestureKind}: More → Gesture`
        if (state === STATE.RESTING) return 'Hold your arm out, still'
        if (state === STATE.AIMING) return 'Aiming…'
        const how = this.detector ? `Press or ${VERB[this.gestureKind] || 'gesture'}` : 'Press'
        const best = this.last.best && this.byId[this.last.best.id]
        const twist = this.dimKind(best) === 'volume' ? ' · twist: volume' : this.dimKind(best) ? ' · twist to dim' : ''
        return state === STATE.LOCKED ? `Locked: ${how.toLowerCase()}${twist}` : `${how} to trigger`
      },

      build() {
        if (!this.allDevices.length) {
          text({ y: 34, h: 44, size: SIZE.title, value: 'Point' })
          text({ x: 60, y: 120, w: 360, h: 200, value: 'Nothing painted yet. Go back and choose Paint a device.' })
          return
        }
        // the whole screen: its colour is the state; tap triggers, hold dims
        this.bg = rect({ color: LOOK[STATE.RESTING][0] })
        this.topW = text({ x: 90, y: 36, w: 300, h: 36, size: 26, value: '' })
        this.nameW = text({ x: 40, y: 96, w: 400, h: 144, size: 46, value: '' })
        this.hintW = text({ x: 50, y: 262, w: 380, h: 84, size: 30, value: this.hint(STATE.RESTING) })
        this.resultW = text({ x: 60, y: 370, w: 360, h: 84, size: 30, value: '' })
        this.texts = [this.topW, this.nameW, this.hintW, this.resultW]
        this.applyRoom()
        for (const w of [this.bg, ...this.texts]) {
          w.addEventListener(uiEvent.CLICK_DOWN, () => this.holdStart())
          w.addEventListener(uiEvent.CLICK_UP, () => this.holdEnd() || this.trigger('tap'))
        }
        this.unkeys = listenKeys(() => !this.justDimmed && this.trigger('button'), {
          onSelectPress: () => this.holdStart(),
          onSelectRelease: () => this.holdEnd(),
        })
        this.aim = startAim((a) => this.onAim(a), {
          onGyro: (t, dps) => {
            if (dps > 2 * TWIST_MAX_DPS) this.fastAt = t // a flick under way isn't a twist
            return this.detector && this.detector.gyroUpdate(t, dps) && this.onGesture(t)
          },
          onAccel: (t, a) => this.detector && this.detector.accelUpdate(t, a) && this.onGesture(t),
        })
        this.detailed = settings().diagnostics.detailed
        if (this.detailed) note('battery', { page: 'point', at: 'open', level: batteryLevel() }) // drain per minute of pointing (tools/replay.mjs)
        // opened straight from launch (Open on Point): the quiet sync Home would have done
        if (firstSyncOfRun()) {
          sync((m, p, t) => ask(this, m, p, t), null, { full: false })
            .then((r) => this.alive && r && r.ok && this.loadDevices())
            .catch(() => null)
        }
        this.checkRoom()
        this.roomTimer = setInterval(() => this.checkRoom(), ROOM_EVERY_MS)
      },

      onAim(a) {
        this.roll = a.roll
        if (this.dim) return this.onDim(a)
        if (this.twistToDim(a)) return
        const r = this.aimer.update(a.t, a.ready, this.devices, a.heading, a.pitch)
        // where the wrist was when a lock on a twistable device began
        if (r.state === STATE.LOCKED && r.best && this.dimKind(this.byId[r.best.id])) {
          if (!this.twistLock || this.twistLock.id !== r.best.id) this.twistLock = { id: r.best.id, roll: a.roll, pitch: a.pitch }
          this.twistLock.t = a.t
        }
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
          lead: r.best ? (r.runnerUp && r.runnerUp.weight ? Math.min(99, r.best.weight / r.runnerUp.weight) : 99) : 0,
        })
        while (this.history.length && a.t - this.history[0].t > HISTORY_MS) this.history.shift()
        if (this.confirming) return
        this.calibration(a)
        if (this.dwell && this.onDwell(a, r)) return
        const bestId = r.best ? r.best.id : null
        const calibrationChanged = a.calibrated !== this.wasCalibrated
        this.wasCalibrated = a.calibrated
        if (!calibrationChanged && r.state === this.last.state && bestId === (this.last.best && this.last.best.id)) {
          this.last = r
          return
        }
        this.last = r
        if (!this.flashing) this.look(r.state)
        setText(this.nameW, r.best ? fit(this.byId[r.best.id].name, 24) : '')
        const hint = this.dwellShown !== null && this.dwellShown !== undefined ? `Hold… ${this.dwellShown}` : this.hint(r.state)
        setText(this.hintW, a.calibrated ? hint : a.noCompass ? 'This watch has no compass' : 'Compass: turn the watch in a circle')
        // one buzz per device found: not again when the lock flickers off and back on the same device
        if (r.state === STATE.LOCKED && r.best && r.best.id !== this.buzzedFor) {
          this.buzzedFor = r.best.id
          haptics.sent()
        }
        if (r.state === STATE.RESTING) this.buzzedFor = null // arm lowered: the next find buzzes again
      },

      /**
       * While the compass isn't calibrated: dots round the edge light as the watch
       * leans each way (lib/circling.js), then all go green, with one buzz, once it is.
       */
      calibration(a) {
        if (a.noCompass) return
        if (!a.calibrated) {
          if (!this.ring) {
            this.ring = tickRing()
            this.circling = new Circling({ ticks: this.ring.dots.length })
          }
          if (!this.circling) {
            // lost again before the green ring went away: start counting again
            clearTimeout(this.ringTimer)
            this.circling = new Circling({ ticks: this.ring.dots.length })
            this.ring.all(0x333333)
          }
          const i = this.circling.add(a.pitch, a.roll)
          if (i >= 0) this.ring.set(i, COLOR.accent)
          if (this.circling.count === this.circling.ticks) {
            this.circling.reset()
            this.ring.all(0x333333)
          }
        } else if (this.ring && this.circling) {
          this.circling = null
          this.ring.all(0x3ddc84)
          haptics.done()
          this.ringTimer = setTimeout(() => {
            if (!this.alive || !this.ring) return
            clear(this.ring.dots)
            this.ring = null
          }, FLASH_MS)
        }
      },

      /** Colour the screen (and its text) for a state, or 'dim', 'done', 'failed', 'confirm'. */
      look(name) {
        const [bg, fg] = LOOK[name] || LOOK[STATE.RESTING]
        setColor(this.bg, bg)
        for (const w of this.texts) setTextColor(w, fg)
      },

      /** Show done or failed for a moment, then the current state again. */
      flash(name) {
        this.flashing = true
        this.look(name)
        clearTimeout(this.flashTimer)
        this.flashTimer = setTimeout(() => {
          this.flashing = false
          if (this.alive && !this.dim && !this.confirming) this.look(this.last.state || STATE.RESTING)
        }, FLASH_MS)
      },

      /** Instant toggle: count down while locked; returns true when it fired. */
      onDwell(a, r) {
        const lockedId = r.state === STATE.LOCKED && r.best ? r.best.id : null
        // keep feeding the aim while a request is out: treating busy as "not aimed"
        // re-armed the device after 1 s, so a slow reply let a still arm fire it again
        const d = this.dwell.update(a.t, lockedId)
        if (d.fire && this.busy) return false
        if (d.fire) {
          this.dwellShown = null
          setText(this.hintW, '')
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

      /** 'light' (brightness), 'volume' (media players that take it), or null: what a twist changes. */
      dimKind(d) {
        if (!d) return null
        return d.volume ? 'volume' : d.dimmable || domainOf(d.id) === 'light' ? 'light' : null
      },

      /** Twist without holding: see TWIST_START. Returns true when it started dimming. */
      twistToDim(a) {
        const lock = this.twistLock
        if (!lock || this.busy || this.confirming || a.t - lock.t > TWIST_LOCK_MEMORY_MS) return false
        if (Date.now() - (this.firedAt || 0) < GESTURE_COOLDOWN_MS) return false // the arm settling after a trigger
        if (Math.abs(a.pitch - lock.pitch) > 12 || a.gyroDps > TWIST_MAX_DPS) return false
        if (a.t - (this.fastAt || 0) < 1500) return false // a flick and the wrist coming back
        if (Math.abs(angleDiff(a.roll, lock.roll)) < TWIST_START) return false
        this.twistLock = null
        this.startDim(lock.id, { roll0: lock.roll, pitch0: lock.pitch, auto: true })
        return !!this.dim
      },

      startDim(id = null, opts = {}) {
        if (!id) {
          const { state, best } = this.last
          if (!best || (state !== STATE.CANDIDATE && state !== STATE.LOCKED)) return
          id = best.id
        }
        const d = this.byId[id]
        const kind = this.dimKind(d)
        if (!kind) return
        const at = this.history[this.history.length - 1] || null
        // auto: started by twisting (no hold), so it ends when the wrist settles or the arm drops
        this.dim = { id: d.id, kind, roll0: opts.roll0 === undefined ? this.roll : opts.roll0, pitch0: opts.pitch0, auto: !!opts.auto, step: 0, at, movedAt: Date.now(), startedAt: Date.now() } // the purple screen says it: no buzz
        this.look('dim')
        setText(this.nameW, fit(d.name, 24))
        setText(this.hintW, this.dimHint(0))
      },

      dimHint(step) {
        const what = this.dim.kind === 'volume' ? 'volume' : ''
        if (!step) return this.dim.kind === 'volume' ? 'Twist: thumb up louder' : 'Twist: thumb up brighter'
        return `${step > 0 ? '+' : ''}${step}%${what ? ` ${what}` : ''}`
      },

      onDim(a) {
        // volume: a full twist is the per-twist limit set in Home Assistant, which also enforces it
        const step = this.dim.kind === 'volume' ? volumeStep(this.dim.roll0, a.roll, settings().volume.step) : dimStep(this.dim.roll0, a.roll)
        const now = Date.now()
        if (step !== this.dim.step) {
          this.dim.step = step
          this.dim.movedAt = now
          setText(this.hintW, this.dimHint(step))
          this.keepAwake()
        }
        if (!this.dim.auto) return // held: sent on release
        // twisted without a hold: sent once the wrist is still, or when the arm drops;
        // turned back to where it started and left there: nothing is sent
        const dropped = this.dim.pitch0 !== undefined && Math.abs(a.pitch - this.dim.pitch0) > 30
        const settled = now - this.dim.movedAt > TWIST_SETTLE_MS
        if (dropped || (settled && (this.dim.step || now - this.dim.startedAt > 3 * TWIST_SETTLE_MS))) this.finishDim()
      },

      finishDim() {
        const { id, step, at, kind } = this.dim
        this.dim = null
        this.twistLock = null
        this.justDimmed = true
        setTimeout(() => {
          this.justDimmed = false
        }, 600)
        this.last = { state: null, best: null, runnerUp: null }
        if (step) this.fire(id, false, { via: kind === 'volume' ? 'volume' : 'dim', action: kind === 'volume' ? 'volume' : 'dim', value: step, at })
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
            this.flash('failed')
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
        this.busy = true // no buzz here: one when it's done (or failed) is enough
        this.firedAt = Date.now()
        this.twistLock = null
        setText(this.nameW, fit(d.name, 24))
        setText(this.resultW, action === 'dim' || action === 'volume' ? `${ctx.value > 0 ? '+' : ''}${ctx.value}%: sending…` : 'Sending…')
        const t0 = Date.now()
        const room = this.room ? this.room.id : null
        ask(this, METHOD.FIRE, { seq: nextSeq(), target: id, action, value: ctx.value, confirmed, via: ctx.via, room }, 10000)
          .then((r) => {
            this.busy = false
            if (!this.alive) return
            if (r && r.needsConfirm) return this.askConfirm(id, ctx)
            if (r && r.ok) {
              haptics.done()
              this.flash('done')
              let shown = r.brightness !== undefined && r.state === 'on' ? `${r.brightness}%` : r.state || 'done'
              if (r.volume !== undefined) shown = `volume ${r.volume}%${r.limited ? ' (limit)' : ''}`
              setText(this.resultW, `${fit(d.name, 18)}: ${shown}`)
              if (ctx.runnerUp && ctx.runnerUp !== id && !ctx.correcting && action === 'toggle') this.offerCorrection(id, ctx)
              if (action === 'toggle' && !ctx.correcting) this.learnLater(id, ctx)
            } else {
              haptics.failed()
              this.flash('failed')
              setText(this.resultW, fit((r && r.error) || 'Failed', 40))
            }
            this.record(id, ctx, r, Date.now() - t0)
          })
          .catch(() => {
            this.busy = false
            if (!this.alive) return
            haptics.failed()
            this.flash('failed')
            setText(this.resultW, 'Phone not reachable')
          })
      },

      // ------------------------------------------------------------ learning (lib/learn.js)
      /**
       * A trigger that locked decisively votes for where the device is, once the
       * "Not it?" offer has passed without a correction.
       */
      learnLater(id, ctx) {
        const at = ctx.at
        if (!settings().learn.enabled || !at || at.best !== id || at.state !== STATE.LOCKED || !(at.lead >= LEARN.minLead)) return
        // one pending vote per device: a quick trigger of another device doesn't cancel this one
        this.learnTimers = this.learnTimers || {}
        clearTimeout(this.learnTimers[id])
        const room = this.room ? this.room.id : null
        this.learnTimers[id] = setTimeout(() => {
          delete this.learnTimers[id]
          if (!this.alive) return
          const next = learnSpot(paints(), id, at, room)
          if (!next) return
          setPaint(id, next)
          syncSoon((m, p, t) => ask(this, m, p, t), 'paints')
          this.loadDevices()
        }, CORRECT_MS + 500)
      },

      /** A room check that matched clearly nudges that room's fingerprint (at most every ROOM_LEARN_MS). */
      learnRoom(r) {
        if (!settings().learn.enabled || r.source !== 'scan' || !r.room || !r.scan || !clearMatch(r.ranked)) return
        const now = Date.now()
        this.roomLearnedAt = this.roomLearnedAt || {}
        if (now - (this.roomLearnedAt[r.room.id] || 0) < ROOM_LEARN_MS) return
        const known = rooms()[r.room.id]
        if (!known || !known.fingerprint) return
        this.roomLearnedAt[r.room.id] = now
        setRoom(r.room.id, { ...known, fingerprint: adaptFingerprint(known.fingerprint, r.scan) })
        syncSoon((m, p, t) => ask(this, m, p, t), 'rooms')
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
        if (this.learnTimers) clearTimeout(this.learnTimers[wrongId]) // the wrong device mustn't learn from this
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
        this.look('confirm')
        setText(this.nameW, fit(d.name, 24))
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
      /** The aim of the seconds before a trigger, for tuning (detailed diagnostics only). */
      record(id, ctx, r, ms) {
        if (!this.detailed) return
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
            roomSure: this.room ? this.room.sure : null,
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
        clearTimeout(this.flashTimer)
        clearTimeout(this.ringTimer)
        for (const t of Object.values(this.learnTimers || {})) clearTimeout(t)
        if (this.aim && this.detailed) note('battery', { page: 'point', at: 'close', level: batteryLevel() })
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
