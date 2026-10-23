// Home: pair with Home Assistant first; then Point, Paint, Sync, Probes.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked, previousRuns, forgetPreviousRuns, noteLaunch } from './trail.js'
import { push } from '@zos/router'
import { text, setText, button, clear, ask, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { targets, paintedDevices, saveTargets, paints, savePaints } from './store.js'

// Before the page's own 'open' entry, so a run's trail starts with its launch.
noteLaunch()

Page(
  BasePage(
    tracked('home', {
      onInit() {
        this.widgets = []
      },

      build() {
        text({ y: 34, h: 44, size: 32, value: 'WristWand' })
        this.statusW = text({ y: 80, h: 30, size: 19, color: COLOR.quiet, value: 'Checking…' })
        ask(this, METHOD.STATUS, undefined, 5000)
          .then((st) => {
            this.render(st || {})
            if (st && st.paired) this.sendTrail()
          })
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
        btn(3, 'More', go('page/more'))
      },

      // What happened in earlier runs (screens, buttons, errors) goes to Home
      // Assistant with the probe results, then is dropped from the watch.
      sendTrail() {
        const trail = previousRuns()
        if (!trail.length) return
        ask(this, METHOD.PROBE_LOG, { test: 'trail', at: Date.now(), trail }, 15000)
          .then((r) => r && r.forwarded && forgetPreviousRuns())
          .catch(() => null)
      },

      sync() {
        setText(this.statusW, 'Syncing devices…')
        ask(this, METHOD.SYNC, undefined, 15000)
          .then(async (r) => {
            if (!(r && r.targets)) {
              setText(this.statusW, (r && r.error) || 'Sync failed')
              return
            }
            saveTargets(r.targets)
            let msg = `${r.targets.length} devices synced`
            // a reset or new watch gets its paints back from Home Assistant
            if (!Object.keys(paints()).length) {
              const b = await ask(this, METHOD.LOAD_PAINTS, undefined, 15000).catch(() => null)
              const restored = (b && b.paints) || {}
              if (Object.keys(restored).length) {
                savePaints(restored)
                msg += `, ${Object.keys(restored).length} paints restored`
              }
            }
            setText(this.statusW, msg)
          })
          .catch(() => setText(this.statusW, 'Phone not reachable'))
      },
    }),
  ),
)
