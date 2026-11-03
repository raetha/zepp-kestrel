// Paint a device: pick it, stand where you'd use it, and sweep the arm gently
// across it for 15 s. The samples become a "spot" the pointer matches against.
// The device list starts with the room you're in, or asks which room.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { text, setText, button, clear, fit, ask, listenKeys, rect, setColor, tickRing, COLOR, SIZE } from './ui.js'
import { Circling } from '../lib/circling.js'
import { startAim } from './aim.js'
import { targets, paints, setPaint, areas, rooms, settings } from './store.js'
import { METHOD } from '../lib/protocol.js'
import { targetsInArea, areaChoices, ALL, ACTION_DOMAINS } from '../lib/areas.js'
import { syncSoon } from './sync.js'
import { detectRoom } from './room.js'
import { stopScan } from './scan.js'
import { makeSpot, addSpot, spotProblem, crowdedBy, MAX_SPOTS } from '../lib/paint.js'
import * as haptics from './haptics.js'

const PER_PAGE = 4
const PAINT_MS = 15000
const CALIBRATE_MS = 30000 // how long Paint waits for the compass to calibrate
// background colours, the same as Point's: amber while recording, green saved, red failed
const BG = { idle: 0x000000, recording: 0x4a3000, saved: 0x0d5a32, crowded: 0x4a3000, failed: 0x7a1c1c }
const TICK = { off: 0x333333, on: COLOR.accent, done: 0x3ddc84 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

Page(
  BasePage(
    tracked('paint', {
      onInit() {
        this.widgets = []
        this.page = 0
        this.area = null // the room whose devices are listed
        this.here = null // the room you're standing in, if known
        this.aim = null
        this.onSelect = null
        this.alive = true
      },

      build() {
        this.bg = rect({ color: BG.idle }) // first, so it stays behind everything
        this.titleW = text({ y: 32, h: 44, size: SIZE.title, value: 'Paint' })
        this.msgW = text({ x: 56, y: 80, w: 368, h: 240, value: '' })
        this.unkeys = listenKeys(() => this.onSelect && this.onSelect())
        this.findRoom()
      },

      add(w) {
        this.widgets.push(w)
        return w
      },

      // ------------------------------------------------------------ which room
      // The device list starts with the room you're in (Bluetooth or a Home
      // Assistant sensor); if that can't be told, you pick the room.
      async findRoom() {
        if (!targets().length) return this.list()
        if (!areas().length) {
          this.area = ALL
          return this.list()
        }
        setText(this.msgW, 'Finding your room…')
        const r = await detectRoom((m, p, t) => ask(this, m, p, t)).catch(() => null)
        if (!this.alive) return
        if (r && r.room) {
          const known = areas().find((a) => a.id === r.room.id)
          this.area = { id: r.room.id, name: (known && known.name) || r.room.name }
          this.here = this.area // where you stand: tags the spots
          this.page = 0
          return this.list()
        }
        this.pickArea()
      },

      pickArea() {
        clear(this.widgets)
        this.onSelect = null
        const choices = areaChoices(targets(), areas())
        const pages = Math.ceil(choices.length / PER_PAGE)
        this.areaPage = Math.min(this.areaPage || 0, pages - 1)
        setText(this.titleW, pages > 1 ? `Room? ${this.areaPage + 1}/${pages}` : 'Which room?')
        setText(this.msgW, '')
        choices.slice(this.areaPage * PER_PAGE, (this.areaPage + 1) * PER_PAGE).forEach((c, i) => {
          this.add(
            button({
              x: 70,
              w: 340,
              y: 80 + i * 62,
              h: 56,
              size: SIZE.body,
              label: `${fit(c.name, 15)} (${c.count})`,
              onClick: () => {
                this.area = { id: c.id, name: c.name }
                // a picked room counts as where you stand if the watch can recognise it later
                this.here = rooms()[c.id] ? this.area : null
                this.page = 0
                this.list()
              },
            }),
          )
        })
        if (pages > 1) {
          this.add(button({ x: 120, w: 110, y: 336, h: 54, size: 32, label: '‹', onClick: () => this.turnAreas(-1, pages) }))
          this.add(button({ x: 250, w: 110, y: 336, h: 54, size: 32, label: '›', onClick: () => this.turnAreas(1, pages) }))
        }
      },

      turnAreas(d, pages) {
        this.areaPage = (this.areaPage + d + pages) % pages
        this.pickArea()
      },

      // ------------------------------------------------------------ pick a device
      list() {
        clear(this.widgets)
        setColor(this.bg, BG.idle)
        this.onSelect = null
        const all = targetsInArea(targets(), this.area)
        if (!targets().length) {
          setText(this.titleW, 'Paint')
          setText(this.msgW, 'No devices yet. Go back and choose Sync.')
          return
        }
        const pages = Math.max(1, Math.ceil(all.length / PER_PAGE))
        this.page = Math.min(this.page, pages - 1)
        const p = paints()
        const name = this.area && this.area.id !== ALL.id ? fit(this.area.name, pages > 1 ? 12 : 14) : 'Paint'
        setText(this.titleW, pages > 1 ? `${name} ${this.page + 1}/${pages}` : name)
        setText(this.msgW, all.length ? '' : 'No devices in this room.')
        all.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((t, i) => {
          const done = p[t.id] && p[t.id].length
          this.add(
            button({
              x: 70,
              w: 340,
              y: 80 + i * 62,
              h: 56,
              size: SIZE.body,
              label: `${done ? '● ' : ''}${fit(t.name, 19)}`,
              onClick: () => this.ready(t),
            }),
          )
        })
        if (pages > 1) {
          this.add(button({ x: 70, w: 92, y: 336, h: 54, size: 32, label: '‹', onClick: () => this.turn(-1, pages) }))
          this.add(button({ x: 318, w: 92, y: 336, h: 54, size: 32, label: '›', onClick: () => this.turn(1, pages) }))
        }
        if (areas().length) this.add(button({ x: 168, w: 144, y: 336, h: 54, size: SIZE.small, label: 'Room', onClick: () => this.pickArea() }))
        this.add(text({ y: 398, h: 32, size: SIZE.small, color: COLOR.quiet, value: '● painted' }))
      },

      turn(d, pages) {
        this.page = (this.page + d + pages) % pages
        this.list()
      },

      // ------------------------------------------------------------ paint it
      ready(t) {
        clear(this.widgets)
        setColor(this.bg, BG.idle)
        this.target = t
        const spots = (paints()[t.id] || []).filter((s) => !s.kind).length
        setText(this.titleW, fit(t.name, 16))
        setText(
          this.msgW,
          (ACTION_DOMAINS.includes(t.id.split('.')[0])
            ? `Pick a spot to point at for it (the sofa, a picture, a corner). Press Start, then sweep slowly across that spot for 15 s.`
            : `Stand where you'd use it and point at it. Press Start, then sweep slowly across it for 15 s.`) +
            (spots ? `\n\nPainted from ${spots} spot${spots > 1 ? 's' : ''}.` : ''),
        )
        this.onSelect = () => this.paint()
        this.add(button({ x: 110, w: 260, y: 326, h: 58, label: 'Start', primary: true, onClick: () => this.paint() }))
        this.add(button({ x: 140, w: 200, y: 394, h: 52, size: SIZE.body, label: 'Back', onClick: () => this.list() }))
      },

      async paint() {
        if (this.painting) return
        this.painting = true
        this.onSelect = null
        clear(this.widgets)
        const samples = []
        const raw = [] // every reading while recording, kept or not (detailed diagnostics)
        const detailed = settings().diagnostics.detailed
        let roomCheck = null
        let calibrated = true
        let noCompass = false
        this.aim = startAim((a) => {
          noCompass = a.noCompass
          calibrated = a.calibrated
          if (this.circling && !calibrated) {
            const i = this.circling.add(a.pitch, a.roll)
            if (i >= 0) this.ring.set(i, TICK.on)
            if (this.circling.count === this.circling.ticks) {
              // a full circle and still not done: start the ring again so it keeps showing movement
              this.circling.reset()
              this.ring.all(TICK.off)
            }
          }
          if (this.recording && a.calibrated && a.heading !== null && Math.abs(a.pitch) <= 75 && Math.abs(a.roll) <= 45) {
            samples.push({ heading: a.heading, pitch: a.pitch })
          }
          if (this.recording && detailed) raw.push([a.t, a.heading, a.pitch, a.roll, Math.round(a.gyroDps || 0), a.calibrated ? 1 : 0, a.yaw])
        }, { yaw: detailed })
        pauseDropWristScreenOff({ duration: 0 })
        this.awake = true
        // which room this is painted from: known from the list, or a short scan now
        this.room = this.here || null
        if (!this.room) {
          detectRoom((m, p, t) => ask(this, m, p, t))
            .then((r) => {
              this.room = r.room
              roomCheck = { source: r.source, room: r.room ? r.room.id : null, ranked: r.ranked, scan: r.scan || null }
            })
            .catch(() => null)
        }
        // An uncalibrated compass would waste the sweep (Zepp OS gives no heading
        // until its own calibration is done; apps can't calibrate it themselves):
        // ask for the Compass app's circling motion and wait, up to CALIBRATE_MS.
        await sleep(500)
        if (!this.alive) return
        if (noCompass) {
          setText(this.msgW, 'This watch has no compass, which Kestrel needs to tell where you point.')
          this.aim.stop()
          this.aim = null
          resetDropWristScreenOff()
          this.awake = false
          this.painting = false
          this.add(button({ x: 140, w: 200, y: 394, h: 52, size: SIZE.body, label: 'Back', onClick: () => this.list() }))
          return
        }
        if (!calibrated) {
          // The dots round the edge light as the watch leans each way: they show the
          // circling motion, since Zepp OS tells apps nothing about calibration until it's done.
          this.ring = tickRing()
          for (const d of this.ring.dots) this.add(d)
          this.circling = new Circling({ ticks: this.ring.dots.length })
          setText(this.msgW, 'The compass needs calibrating.\n\nTurn the watch slowly in a circle, as the Compass app asks, until the dots go green.')
          const until = Date.now() + CALIBRATE_MS
          while (!calibrated && Date.now() < until) {
            await sleep(250)
            if (!this.alive) return
          }
          this.circling = null
          if (calibrated) {
            this.ring.all(TICK.done)
            setText(this.msgW, 'Compass calibrated.')
            haptics.done()
            await sleep(900)
            if (!this.alive) return
          }
          clear(this.widgets)
        }
        this.bigW = this.add(text({ y: 170, h: 150, size: 120, value: '' })) // the countdown, readable at arm's length
        for (let s = 3; s > 0; s--) {
          setText(this.msgW, 'Point at it…')
          setText(this.bigW, String(s))
          await sleep(800)
          if (!this.alive) return
        }
        haptics.sent()
        setColor(this.bg, BG.recording)
        this.recording = true
        const end = Date.now() + PAINT_MS
        while (Date.now() < end) {
          const left = Math.ceil((end - Date.now()) / 1000)
          setText(this.msgW, calibrated ? 'Sweep slowly across it…' : 'Sweep slowly across it…\n(compass not calibrated)')
          setText(this.bigW, `${left}`)
          await sleep(250)
          if (!this.alive) return
        }
        this.recording = false
        setColor(this.bg, BG.idle)
        resetDropWristScreenOff()
        this.awake = false
        this.aim.stop()
        this.aim = null
        this.painting = false
        haptics.done()
        const spot = makeSpot(samples)
        if (spot && this.room) spot.room = this.room.id
        if (detailed) this.recordSweep(spot, raw, roomCheck)
        clear([this.bigW])
        this.saved(spot)
      },

      /** The whole sweep, for tuning (detailed diagnostics only). */
      recordSweep(spot, raw, roomCheck) {
        const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10)
        const t0 = raw.length ? raw[0][0] : 0
        ask(
          this,
          METHOD.PROBE_LOG,
          {
            test: 'paint',
            at: Date.now(),
            target: this.target ? this.target.id : null,
            spot: spot || null,
            room: this.room ? this.room.id : null,
            roomCheck,
            columns: 'ms,heading,pitch,roll,gyro,cal,yaw',
            trace: raw.map((x) => [x[0] - t0, r1(x[1]), r1(x[2]), r1(x[3]), x[4], x[5], r1(x[6])]),
          },
          15000,
        ).catch(() => null)
      },

      saved(spot) {
        const t = this.target
        const problem = spotProblem(spot)
        if (problem) {
          haptics.failed()
          setColor(this.bg, BG.failed)
          setText(
            this.msgW,
            problem === 'few'
              ? 'Too few compass readings: the compass isn\'t calibrated. Open the Compass app and follow its prompt, then try again.'
              : `The compass was unsteady (±${Math.round(spot.headingSpread)}°). Sweep less widely, away from metal, and try again.`,
          )
        } else {
          const spots = addSpot(paints()[t.id], spot)
          setPaint(t.id, spots)
          syncSoon((m, p, tm) => ask(this, m, p, tm), 'paints')
          const n = spots.filter((x) => x.kind !== 'correction').length
          const crowd = crowdedBy(paints(), t.id, spot)
          const near = crowd && (targets().find((x) => x.id === crowd.id) || { name: crowd.id })
          setColor(this.bg, crowd ? BG.crowded : BG.saved)
          setText(
            this.msgW,
            `Saved${this.room ? ` in ${this.room.name}` : ''}: ${Math.round(spot.heading)}° ±${Math.round(spot.headingSpread)}, pitch ${Math.round(spot.pitch)}°.\n` +
              (crowd
                ? `\nOnly ${crowd.headingGap}° from ${fit(near.name, 20)}: hard to tell apart from here. Paint again where they're further apart.`
                : `\nSpot ${n} of ${MAX_SPOTS}. Painting from another place you use it improves aim.`),
          )
        }
        this.add(button({ x: 84, w: 148, y: 340, h: 58, label: 'Again', onClick: () => this.ready(t) }))
        this.add(button({ x: 248, w: 148, y: 340, h: 58, label: 'Done', primary: true, onClick: () => this.list() }))
      },

      onDestroy() {
        stopScan()
        if (this.aim) this.aim.stop()
        this.unkeys && this.unkeys()
        this.alive = false
        if (this.awake) resetDropWristScreenOff()
      },
    }),
  ),
)
