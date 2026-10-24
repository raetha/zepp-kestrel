// More: the Home Assistant address in use, the gesture trigger, instant
// toggle, rooms, the M0 probes, and unpairing.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { push, back } from '@zos/router'
import { text, setText, setLabel, button, ask, listenKeys, COLOR, SIZE } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { gesture, rooms, settings, setSetting } from './store.js'
import { syncSoon } from './sync.js'

// Instant toggle: Off, then these delays in seconds (any value can be set in Home Assistant)
const DWELL_STEPS = [2, 3, 5]

Page(
  BasePage(
    tracked('more', {
      onInit() {
        this.alive = true
      },

      build() {
        this.unkeys = listenKeys()
        const g = gesture()
        const nRooms = Object.keys(rooms()).length
        text({ y: 34, h: 44, size: SIZE.title, value: 'More' })
        // the address the phone reaches Home Assistant at (the last one that answered)
        this.statusW = text({ x: 70, y: 76, w: 340, h: 58, size: SIZE.small, color: COLOR.quiet, value: '' })
        ask(this, METHOD.STATUS, undefined, 5000)
          .then((st) => this.alive && st && st.url && setText(this.statusW, st.url.replace(/^http:\/\//, '')))
          .catch(() => null)
        const btn = (i, label, onClick) => button({ x: 100, w: 280, y: 136 + i * 58, h: 52, label, onClick })
        btn(0, `Gesture: ${g.enabled ? g.kind : 'off'}`, () => push({ url: 'page/gesture' }))
        this.dwellW = btn(1, this.dwellLabel(), () => this.nextDwell())
        btn(2, `Rooms${nRooms ? ` (${nRooms})` : ''}`, () => push({ url: 'page/rooms' }))
        btn(3, 'Probes', () => push({ url: 'page/probes' }))
        btn(4, 'Unpair', () => this.unpair())
      },

      dwellLabel() {
        const d = settings().dwell
        return `Instant: ${d.enabled ? `${d.seconds} s` : 'off'}`
      },

      // Off -> 2 s -> 3 s -> 5 s -> Off
      nextDwell() {
        const d = settings().dwell
        const next = d.enabled ? DWELL_STEPS.find((s) => s > d.seconds) : DWELL_STEPS[0]
        setSetting('dwell', next ? { enabled: true, seconds: next } : { enabled: false })
        setLabel(this.dwellW, this.dwellLabel())
        setText(this.statusW, next ? `Hold ${next} s on a device` : 'Instant toggle off')
        syncSoon((m, p, t) => ask(this, m, p, t), 'settings')
      },

      unpair() {
        setText(this.statusW, 'Unpairing…')
        ask(this, METHOD.UNPAIR)
          .then(() => back())
          .catch(() => setText(this.statusW, 'Phone not reachable'))
      },

      onDestroy() {
        this.alive = false
        this.unkeys && this.unkeys()
      },
    }),
  ),
)
