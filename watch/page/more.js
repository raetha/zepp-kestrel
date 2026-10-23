// More: the gesture trigger, rooms, the M0 probes, and unpairing.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { push, back } from '@zos/router'
import { text, setText, button, ask, listenKeys, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { gesture, rooms } from './store.js'

Page(
  BasePage(
    tracked('more', {
      build() {
        this.unkeys = listenKeys()
        const g = gesture()
        const nRooms = Object.keys(rooms()).length
        text({ y: 34, h: 40, size: 28, value: 'More' })
        this.statusW = text({ y: 74, h: 30, size: 18, color: COLOR.quiet, value: '' })
        const btn = (i, label, onClick) => button({ x: 110, w: 260, y: 112 + i * 66, h: 54, label, onClick })
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
        this.unkeys && this.unkeys()
      },
    }),
  ),
)
