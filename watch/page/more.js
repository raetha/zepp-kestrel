// More: the flick gesture, the M0 probes, and unpairing.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { push, back } from '@zos/router'
import { text, setText, button, ask, listenKeys, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { flickSettings } from './store.js'

Page(
  BasePage(
    tracked('more', {
      build() {
        this.unkeys = listenKeys()
        const f = flickSettings()
        text({ y: 40, h: 40, size: 28, value: 'More' })
        this.statusW = text({ y: 80, h: 30, size: 18, color: COLOR.quiet, value: '' })
        const btn = (i, label, onClick) => button({ x: 110, w: 260, y: 126 + i * 68, h: 56, label, onClick })
        btn(0, `Flick: ${f.enabled ? 'on' : 'off'}`, () => push({ url: 'page/flick' }))
        btn(1, 'Probes', () => push({ url: 'page/probes' }))
        btn(2, 'Unpair', () => this.unpair())
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
