// Rooms: teach the watch what each Home Assistant area sounds like over
// Bluetooth, so pointing only considers devices painted in the room you're
// in. Calibrating walks the room for three short scans (lib/rooms.js). The
// fingerprints go to Home Assistant, where they can be deleted in the
// integration's options. "Where am I?" tests detection.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { text, setText, button, clear, fit, ask, listenKeys, COLOR, SIZE } from './ui.js'
import { areas, rooms, setRoom, settings } from './store.js'
import { syncSoon } from './sync.js'
import { scanOnce, stopScan } from './scan.js'
import { detectRoom } from './room.js'
import { buildFingerprint, soundsLike } from '../lib/rooms.js'
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
        this.titleW = text({ y: 32, h: 44, size: SIZE.title, value: 'Rooms' })
        this.msgW = text({ x: 56, y: 80, w: 368, h: 240, value: '' })
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
          this.add(button({ x: 110, w: 260, y: 336, h: 58, label: 'Where am I?', primary: true, onClick: () => this.where() }))
          return
        }
        if (!all.length) {
          setText(this.msgW, 'No areas yet. Create areas in Home Assistant, then Sync.')
          return
        }
        const pages = Math.ceil(all.length / PER_PAGE)
        this.page = Math.min(this.page, pages - 1)
        const known = rooms()
        setText(this.titleW, pages > 1 ? `Rooms ${this.page + 1}/${pages}` : 'Rooms')
        setText(this.msgW, '')
        all.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((a, i) => {
          this.add(
            button({
              x: 70,
              w: 340,
              y: 80 + i * 62,
              h: 56,
              size: SIZE.body,
              label: `${known[a.id] ? '● ' : ''}${fit(a.name, 19)}`,
              onClick: () => this.ready(a),
            }),
          )
        })
        if (pages > 1) {
          this.add(button({ x: 70, w: 92, y: 336, h: 54, size: 32, label: '‹', onClick: () => this.turn(-1, pages) }))
          this.add(button({ x: 318, w: 92, y: 336, h: 54, size: 32, label: '›', onClick: () => this.turn(1, pages) }))
        }
        this.add(button({ x: 168, w: 144, y: 336, h: 54, size: SIZE.small, label: 'Where?', onClick: () => this.where() }))
        this.add(text({ y: 398, h: 32, size: SIZE.small, color: COLOR.quiet, value: '● calibrated' }))
      },

      turn(d, pages) {
        this.page = (this.page + d + pages) % pages
        this.list()
      },

      ready(area) {
        clear(this.widgets)
        setText(this.titleW, fit(area.name, 16))
        setText(this.msgW, `Walk slowly around ${area.name} while the watch listens (${SCANS} scans of ${SCAN_MS / 1000} s), including the places you'd point from.`)
        this.add(button({ x: 110, w: 260, y: 326, h: 58, label: 'Start', primary: true, onClick: () => this.calibrate(area) }))
        this.add(button({ x: 140, w: 200, y: 394, h: 52, size: SIZE.body, label: 'Back', onClick: () => this.list() }))
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
            if (i === 0) haptics.sent() // one to start, one when done: not one per scan
            const scan = await scanOnce(SCAN_MS, (n) => this.alive && setText(this.msgW, `Scan ${i + 1} of ${SCANS}: keep walking…\n${n} heard`))
            if (!this.alive) return
            if (!scan) {
              setText(this.msgW, 'Bluetooth was busy. Try again in a few seconds.')
              this.add(button({ x: 140, w: 200, y: 394, h: 52, size: SIZE.body, label: 'Back', onClick: () => this.list() }))
              return
            }
            scans.push(scan.map((d) => ({ mac: d.mac, rssi: d.rssi })))
          }
          haptics.done()
          const fingerprint = buildFingerprint(scans)
          const n = Object.keys(fingerprint).length
          if (n < 3) {
            setText(this.msgW, `Only ${n} steady Bluetooth device${n === 1 ? '' : 's'} heard: not enough to recognise ${area.name}. Rooms with smart speakers or TVs work best.`)
          } else {
            setRoom(area.id, { name: area.name, fingerprint, scans: SCANS, at: Date.now() })
            syncSoon((m, p, t) => ask(this, m, p, t), 'rooms')
            const alike = soundsLike(rooms(), area.id)
            setText(
              this.msgW,
              alike
                ? `${area.name} calibrated: ${n} steady devices.\n\nIt sounds a lot like ${fit(alike.name, 18)} to Bluetooth, so the watch often can't tell them apart. Aim does the work there.`
                : `${area.name} calibrated: ${n} steady devices.\n\nNow paint devices from here, so the watch knows they're in this room.`,
            )
          }
          // the raw scans only with detailed diagnostics (they hold neighbours' Bluetooth addresses)
          if (settings().diagnostics.detailed) {
            ask(this, METHOD.PROBE_LOG, { test: 'room', at: Date.now(), area: area.id, name: area.name, devices: n, scans }, 15000).catch(() => null)
          }
          this.add(button({ x: 140, w: 200, y: 394, h: 52, size: SIZE.body, label: 'Done', primary: true, onClick: () => this.list() }))
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
          ask(this, METHOD.PROBE_LOG, { test: 'where', at: Date.now(), room: r.room, source: r.source, ranked: r.ranked }, 15000).catch(() => null)
        } finally {
          this.busy = false
          this.add(button({ x: 140, w: 200, y: 394, h: 52, size: SIZE.body, label: 'Back', onClick: () => this.list() }))
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
