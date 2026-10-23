// Home: pair with Home Assistant first; then Point, Paint, Sync, Probes.

import { BasePage } from '@zeppos/zml/base-page'
import { push } from '@zos/router'
import { text, setText, button, clear, ask, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { targets, paintedDevices, saveTargets } from './store.js'

Page(
  BasePage({
    onInit() {
      this.widgets = []
    },

    build() {
      text({ y: 34, h: 44, size: 32, value: 'WristWand' })
      this.statusW = text({ y: 80, h: 30, size: 19, color: COLOR.quiet, value: 'Checking…' })
      ask(this, METHOD.STATUS, undefined, 5000)
        .then((st) => this.render(st || {}))
        .catch(() => this.render({ offline: true }))
    },

    render(st) {
      clear(this.widgets)
      const add = (w) => this.widgets.push(w)
      const go = (url) => () => push({ url })
      const btn = (i, label, onClick, primary = false) =>
        add(button({ x: 120, w: 240, y: 126 + i * 66, h: 54, label, onClick, primary }))

      if (st.offline) {
        setText(this.statusW, 'Phone not reachable')
      } else if (!st.paired) {
        setText(this.statusW, 'Not connected to Home Assistant')
      } else {
        const painted = paintedDevices().length
        setText(this.statusW, `${st.haName} · ${painted} painted`)
      }

      if (!st.paired && !st.offline) {
        btn(0, 'Pair with HA', go('page/pair'), true)
        btn(1, 'Probes', go('page/probes'))
        return
      }
      btn(0, 'Point', go('page/point'), true)
      btn(1, 'Paint a device', go('page/paint'))
      btn(2, `Sync (${targets().length})`, () => this.sync())
      btn(3, 'Probes', go('page/probes'))
      if (!st.offline) btn(4, 'Unpair', () => this.unpair())
    },

    sync() {
      setText(this.statusW, 'Syncing devices…')
      ask(this, METHOD.SYNC, undefined, 15000)
        .then((r) => {
          if (r && r.targets) {
            saveTargets(r.targets)
            setText(this.statusW, `${r.targets.length} devices synced`)
          } else {
            setText(this.statusW, (r && r.error) || 'Sync failed')
          }
        })
        .catch(() => setText(this.statusW, 'Phone not reachable'))
    },

    unpair() {
      ask(this, METHOD.UNPAIR)
        .then(() => this.render({ paired: false }))
        .catch(() => setText(this.statusW, 'Phone not reachable'))
    },
  }),
)
