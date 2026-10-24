// Paint a device: pick it, stand where you'd use it, and sweep the arm gently
// across it for 15 s. The samples become a "spot" the pointer matches against.
// The device list starts with the room you're in, or asks which room.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { text, setText, button, clear, fit, ask, listenKeys, COLOR } from './ui.js'
import { startAim } from './aim.js'
import { targets, paints, setPaint, areas, rooms } from './store.js'
import { targetsInArea, areaChoices, ALL } from '../lib/areas.js'
import { syncSoon } from './sync.js'
import { detectRoom } from './room.js'
import { stopScan } from './scan.js'
import { makeSpot, addSpot, spotProblem, MAX_SPOTS } from '../lib/paint.js'
import * as haptics from './haptics.js'

const PER_PAGE = 4
const PAINT_MS = 15000
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
        this.titleW = text({ y: 34, h: 40, size: 28, value: 'Paint' })
        this.msgW = text({ x: 60, y: 80, w: 360, h: 200, size: 21, value: '' })
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
        setText(this.titleW, pages > 1 ? `Which room? (${this.areaPage + 1}/${pages})` : 'Which room?')
        setText(this.msgW, '')
        choices.slice(this.areaPage * PER_PAGE, (this.areaPage + 1) * PER_PAGE).forEach((c, i) => {
          this.add(
            button({
              x: 70,
              w: 340,
              y: 80 + i * 62,
              h: 54,
              size: 21,
              label: `${fit(c.name, 16)} (${c.count})`,
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
          this.add(button({ x: 130, w: 100, y: 334, h: 48, label: '‹', onClick: () => this.turnAreas(-1, pages) }))
          this.add(button({ x: 250, w: 100, y: 334, h: 48, label: '›', onClick: () => this.turnAreas(1, pages) }))
        }
      },

      turnAreas(d, pages) {
        this.areaPage = (this.areaPage + d + pages) % pages
        this.pickArea()
      },

      // ------------------------------------------------------------ pick a device
      list() {
        clear(this.widgets)
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
        const name = this.area && this.area.id !== ALL.id ? fit(this.area.name, 12) : 'Paint'
        setText(this.titleW, pages > 1 ? `${name} (${this.page + 1}/${pages})` : name)
        setText(this.msgW, all.length ? '' : 'No devices in this room.')
        all.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((t, i) => {
          const done = p[t.id] && p[t.id].length
          this.add(
            button({
              x: 70,
              w: 340,
              y: 80 + i * 62,
              h: 54,
              size: 21,
              label: `${done ? '● ' : ''}${fit(t.name, 20)}`,
              onClick: () => this.ready(t),
            }),
          )
        })
        if (pages > 1) {
          this.add(button({ x: 70, w: 100, y: 334, h: 48, label: '‹', onClick: () => this.turn(-1, pages) }))
          this.add(button({ x: 310, w: 100, y: 334, h: 48, label: '›', onClick: () => this.turn(1, pages) }))
        }
        if (areas().length) this.add(button({ x: 175, w: 130, y: 334, h: 48, size: 18, label: 'Room', onClick: () => this.pickArea() }))
        this.add(text({ y: 392, h: 26, size: 16, color: COLOR.quiet, value: '● already painted' }))
      },

      turn(d, pages) {
        this.page = (this.page + d + pages) % pages
        this.list()
      },

      // ------------------------------------------------------------ paint it
      ready(t) {
        clear(this.widgets)
        this.target = t
        const spots = (paints()[t.id] || []).length
        setText(this.titleW, fit(t.name, 20))
        setText(
          this.msgW,
          `Stand where you'd use it and point at it.\nPress Start, then sweep your arm slowly across it for 15 s.${spots ? `\n\nPainted from ${spots} spot${spots > 1 ? 's' : ''} so far.` : ''}`,
        )
        this.onSelect = () => this.paint()
        this.add(button({ x: 120, w: 240, y: 330, h: 58, label: 'Start', primary: true, onClick: () => this.paint() }))
        this.add(button({ x: 150, w: 180, y: 398, h: 46, size: 20, label: 'Back', onClick: () => this.list() }))
      },

      async paint() {
        if (this.painting) return
        this.painting = true
        this.onSelect = null
        clear(this.widgets)
        const samples = []
        let calibrated = true
        this.aim = startAim((a) => {
          calibrated = a.calibrated
          if (this.recording && a.calibrated && a.heading !== null && Math.abs(a.pitch) <= 75 && Math.abs(a.roll) <= 45) {
            samples.push({ heading: a.heading, pitch: a.pitch })
          }
        })
        pauseDropWristScreenOff({ duration: 0 })
        this.awake = true
        // which room this is painted from: known from the list, or a short scan now
        this.room = this.here || null
        if (!this.room) {
          detectRoom((m, p, t) => ask(this, m, p, t))
            .then((r) => {
              this.room = r.room
            })
            .catch(() => null)
        }
        for (let s = 3; s > 0; s--) {
          setText(this.msgW, `Point at it…\n\n${s}`)
          await sleep(800)
          if (!this.alive) return
        }
        haptics.sent()
        this.recording = true
        const end = Date.now() + PAINT_MS
        while (Date.now() < end) {
          const left = Math.ceil((end - Date.now()) / 1000)
          setText(this.msgW, `Sweep slowly across it…\n\n${left} s${calibrated ? '' : '\n(compass not calibrated)'}`)
          await sleep(250)
          if (!this.alive) return
        }
        this.recording = false
        resetDropWristScreenOff()
        this.awake = false
        this.aim.stop()
        this.aim = null
        this.painting = false
        haptics.done()
        const spot = makeSpot(samples)
        if (spot && this.room) spot.room = this.room.id
        this.saved(spot)
      },

      saved(spot) {
        const t = this.target
        const problem = spotProblem(spot)
        if (problem) {
          haptics.failed()
          setText(
            this.msgW,
            problem === 'few'
              ? 'Not enough compass readings. Calibrate the compass (open the Compass app and follow its prompt), then try again.'
              : `The compass was unsteady (±${Math.round(spot.headingSpread)}°). Sweep a little less widely, away from metal, and try again.`,
          )
        } else {
          const spots = addSpot(paints()[t.id], spot)
          setPaint(t.id, spots)
          syncSoon((m, p, tm) => ask(this, m, p, tm), 'paints')
          const n = spots.filter((x) => x.kind !== 'correction').length
          setText(
            this.msgW,
            `Saved${this.room ? ` in ${this.room.name}` : ''}: ${Math.round(spot.heading)}° ±${Math.round(spot.headingSpread)}, pitch ${Math.round(spot.pitch)}°.\n\nSpot ${n} of up to ${MAX_SPOTS}. Painting again from another place you use it improves aim.`,
          )
        }
        this.add(button({ x: 90, w: 140, y: 340, h: 56, size: 22, label: 'Again', onClick: () => this.ready(t) }))
        this.add(button({ x: 250, w: 140, y: 340, h: 56, size: 22, label: 'Done', primary: true, onClick: () => this.list() }))
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
