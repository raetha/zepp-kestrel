// Home: pair with Home Assistant first; then Point, Paint, Sync, More.
// Syncs quietly once per run, so changes made in Home Assistant arrive.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked, previousRuns, forgetPreviousRuns, noteLaunch } from './trail.js'
import { push } from '@zos/router'
import { text, setText, setLabel, button, clear, ask, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { targets, paintedDevices } from './store.js'
import { sync } from './sync.js'

// Before the page's own 'open' entry, so a run's trail starts with its launch.
noteLaunch()

/** True on the first home visit of this run (the app's globalData lives for the run). */
function firstVisit() {
  try {
    const g = getApp()._options.globalData
    if (g.synced) return false
    g.synced = true
    return true
  } catch (e) {
    return false
  }
}

Page(
  BasePage(
    tracked('home', {
      onInit() {
        this.widgets = []
        this.alive = true
      },

      onDestroy() {
        this.alive = false
      },

      build() {
        text({ y: 34, h: 44, size: 32, value: 'WristWand' })
        this.statusW = text({ y: 80, h: 30, size: 19, color: COLOR.quiet, value: 'Checking…' })
        ask(this, METHOD.STATUS, undefined, 5000)
          .then((st) => {
            if (!this.alive) return
            this.render(st || {})
            if (st && st.paired) {
              this.sendTrail()
              if (firstVisit()) this.sync(true)
            }
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
        this.syncW = button({ x: 120, w: 240, y: 126 + 2 * 66, h: 54, label: `Sync (${targets().length})`, onClick: () => this.sync() })
        add(this.syncW)
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

      // Targets, areas, settings, paints and rooms from Home Assistant (page/sync.js).
      sync(quiet = false) {
        if (!quiet) setText(this.statusW, 'Syncing…')
        sync((m, p, t) => ask(this, m, p, t))
          .then((r) => {
            if (!this.alive) return
            if (!r.ok) {
              if (!quiet) setText(this.statusW, r.error || 'Sync failed')
              return
            }
            const parts = [`${r.targets || 0} devices`]
            if (r.paints !== undefined) parts.push(`${r.paints} painted`)
            if (r.rooms) parts.push(`${r.rooms} rooms`)
            setText(this.statusW, parts.join(' · '))
            if (this.syncW) setLabel(this.syncW, `Sync (${targets().length})`)
          })
          .catch(() => !quiet && setText(this.statusW, 'Phone not reachable'))
      },
    }),
  ),
)
