// Rooms: teach the watch what each Home Assistant area sounds like over
// Bluetooth, so pointing only considers devices painted in the room you're
// in. Calibrating walks the room for three short scans (lib/rooms.js). The
// fingerprints go to Home Assistant, where they can be deleted in the
// integration's options. "Where am I?" tests detection.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { text, setText, button, clear, fit, ask, listenKeys, COLOR } from './ui.js'
import { areas, rooms, setRoom, settings } from './store.js'
import { syncSoon } from './sync.js'
import { scanOnce, stopScan } from './scan.js'
import { detectRoom } from './room.js'
import { buildFingerprint } from '../lib/rooms.js'
import { METHOD } from '../lib/protocol.js'
import * as haptics from './haptics.js'

const PER_PAGE = 4
const SCANS = 3
const SCAN_MS = 5000

Page(
  BasePage(
    tracked('rooms', {
      onInit() {
        this.widgets = []
        this.page = 0
        this.alive = true
        this.busy = false
        this.awake = false
      },

      build() {
        this.unkeys = listenKeys()
        this.titleW = text({ y: 34, h: 40, size: 28, value: 'Rooms' })
        this.msgW = text({ x: 60, y: 80, w: 360, h: 230, size: 20, value: '' })
        this.list()
      },

      add(w) {
        this.widgets.push(w)
        return w
      },

      list() {
        clear(this.widgets)
        const all = areas()
        if (settings().room.source === 'sensor') {
          setText(this.msgW, 'Rooms come from a Home Assistant sensor (set in the integration\'s options), so no calibration is needed here.')
          this.add(button({ x: 110, w: 260, y: 330, h: 56, label: 'Where am I?', primary: true, onClick: () => this.where() }))
          return
        }
        if (!all.length) {
          setText(this.msgW, 'No areas yet. Create areas in Home Assistant, then Sync.')
          return
        }
        const pages = Math.ceil(all.length / PER_PAGE)
        this.page = Math.min(this.page, pages - 1)
        const known = rooms()
        setText(this.titleW, pages > 1 ? `Rooms (${this.page + 1}/${pages})` : 'Rooms')
        setText(this.msgW, '')
        all.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((a, i) => {
          this.add(
            button({
              x: 70,
              w: 340,
              y: 80 + i * 62,
              h: 54,
              size: 21,
              label: `${known[a.id] ? '● ' : ''}${fit(a.name, 20)}`,
              onClick: () => this.ready(a),
            }),
          )
        })
        if (pages > 1) {
          this.add(button({ x: 70, w: 100, y: 334, h: 48, label: '‹', onClick: () => this.turn(-1, pages) }))
          this.add(button({ x: 310, w: 100, y: 334, h: 48, label: '›', onClick: () => this.turn(1, pages) }))
        }
        this.add(button({ x: 175, w: 130, y: 334, h: 48, size: 18, label: 'Where am I?', onClick: () => this.where() }))
        this.add(text({ y: 392, h: 26, size: 16, color: COLOR.quiet, value: '● calibrated' }))
      },

      turn(d, pages) {
        this.page = (this.page + d + pages) % pages
        this.list()
      },

      ready(area) {
        clear(this.widgets)
        setText(this.titleW, fit(area.name, 20))
        setText(this.msgW, `Walk slowly around ${area.name} while the watch listens: ${SCANS} scans of ${SCAN_MS / 1000} s. Include the places you'd point from.`)
        this.add(button({ x: 120, w: 240, y: 330, h: 56, label: 'Start', primary: true, onClick: () => this.calibrate(area) }))
        this.add(button({ x: 150, w: 180, y: 396, h: 46, size: 20, label: 'Back', onClick: () => this.list() }))
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

      async calibrate(area) {
        if (this.busy) return
        this.busy = true
        clear(this.widgets)
        this.keepAwake(true)
        try {
          const scans = []
          for (let i = 0; i < SCANS; i++) {
            if (!this.alive) return
            haptics.sent()
            const scan = await scanOnce(SCAN_MS, (n) => this.alive && setText(this.msgW, `Scan ${i + 1} of ${SCANS}: keep walking…\n${n} heard`))
            if (!this.alive) return
            if (!scan) {
              setText(this.msgW, 'Bluetooth was busy. Try again in a few seconds.')
              this.add(button({ x: 150, w: 180, y: 396, h: 46, size: 20, label: 'Back', onClick: () => this.list() }))
              return
            }
            scans.push(scan.map((d) => ({ mac: d.mac, rssi: d.rssi })))
          }
          haptics.done()
          const fingerprint = buildFingerprint(scans)
          const n = Object.keys(fingerprint).length
          if (n < 3) {
            setText(this.msgW, `Only ${n} steady Bluetooth device${n === 1 ? '' : 's'} heard in ${area.name}: not enough to recognise it. Rooms with more smart devices, speakers or TVs work best.`)
          } else {
            setRoom(area.id, { name: area.name, fingerprint, scans: SCANS, at: Date.now() })
            syncSoon((m, p, t) => ask(this, m, p, t), 'rooms')
            setText(this.msgW, `${area.name} calibrated: ${n} steady devices.\n\nPaint devices from here now, so the watch knows they belong to this room.`)
          }
          ask(this, METHOD.PROBE_LOG, { test: 'room', at: Date.now(), area: area.id, name: area.name, devices: n, scans }, 15000).catch(() => null)
          this.add(button({ x: 150, w: 180, y: 396, h: 46, size: 20, label: 'Done', primary: true, onClick: () => this.list() }))
        } finally {
          this.busy = false
          this.keepAwake(false)
        }
      },

      async where() {
        if (this.busy) return
        this.busy = true
        clear(this.widgets)
        setText(this.msgW, 'Listening…')
        try {
          const r = await detectRoom((m, p, t) => ask(this, m, p, t))
          if (!this.alive) return
          const known = rooms()
          const others = (r.ranked || []).map((x) => `${(known[x.id] && known[x.id].name) || x.id}: ${x.score}`).join('\n')
          setText(
            this.msgW,
            r.room
              ? `You're in ${r.room.name}.${others ? `\n\n${others}` : ''}`
              : r.source === null
                ? 'No rooms calibrated yet.'
                : `Not sure which room.${others ? `\n\n${others}` : ''}`,
          )
          ask(this, METHOD.PROBE_LOG, { test: 'where', at: Date.now(), ...r }, 15000).catch(() => null)
        } finally {
          this.busy = false
          this.add(button({ x: 150, w: 180, y: 396, h: 46, size: 20, label: 'Back', onClick: () => this.list() }))
        }
      },

      onDestroy() {
        this.alive = false
        stopScan()
        this.unkeys && this.unkeys()
        if (this.awake) this.keepAwake(false)
      },
    }),
  ),
)
