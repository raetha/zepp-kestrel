// More: the Home Assistant address in use, the gesture trigger, rooms, the M0
// probes, and unpairing.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { push, back } from '@zos/router'
import { text, setText, button, ask, listenKeys, COLOR, SIZE } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { gesture, rooms } from './store.js'

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
        const btn = (i, label, onClick) => button({ x: 100, w: 280, y: 136 + i * 64, h: 56, label, onClick })
        btn(0, `Gesture: ${g.enabled ? g.kind : 'off'}`, () => push({ url: 'page/gesture' }))
        btn(1, `Rooms${nRooms ? ` (${nRooms})` : ''}`, () => push({ url: 'page/rooms' }))
        btn(2, 'Probes', () => push({ url: 'page/probes' }))
        btn(3, 'Unpair', () => this.unpair())
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
