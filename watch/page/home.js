// Home: pair with Home Assistant first; then Point, Paint, Sync, More.
// Syncs quietly once per run, so changes made in Home Assistant arrive.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked, previousRuns, forgetPreviousRuns, noteLaunch, appVersion } from './trail.js'
import { push } from '@zos/router'
import { text, setText, setLabel, button, clear, ask, COLOR, SIZE } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { targets, paintedDevices, settings } from './store.js'
import { sync, firstSyncOfRun, firstOpenOfRun } from './sync.js'

// Before the page's own 'open' entry, so a run's trail starts with its launch.
noteLaunch()


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
        // Open on Point (More, or Home Assistant): for launching from the shortcut key.
        // Only when the app starts; back from Point lands here as usual.
        if (firstOpenOfRun() && settings().start.point && paintedDevices().length) {
          push({ url: 'page/point', params: JSON.stringify({ launched: true }) })
          return
        }
        text({ y: 30, h: 46, size: SIZE.title, value: 'Kestrel' })
        // the build, so it's clear which test build is running
        text({ x: 90, y: 414, w: 300, h: 36, size: 26, color: COLOR.quiet, value: appVersion() })
        this.statusW = text({ x: 50, y: 78, w: 380, h: 64, size: SIZE.small, color: COLOR.quiet, value: 'Checking…' })
        ask(this, METHOD.STATUS, undefined, 5000)
          .then((st) => {
            if (!this.alive) return
            this.render(st || {})
            if (st && st.paired) {
              this.sendTrail()
              if (firstSyncOfRun()) this.sync(true)
            }
          })
          .catch(() => this.render({ offline: true }))
      },

      render(st) {
        clear(this.widgets)
        const add = (w) => this.widgets.push(w)
        const go = (url) => () => push({ url })
        const btn = (i, label, onClick, primary = false) =>
          add(button({ x: 110, w: 260, y: 146 + i * 64, h: 56, label, onClick, primary }))

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
        this.syncW = button({ x: 110, w: 260, y: 146 + 2 * 64, h: 56, label: `Sync (${targets().length})`, onClick: () => this.sync() })
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
      // The Sync button fetches everything; the quiet sync at launch only what
      // changed. Sync pressed while one runs is ignored, with a note.
      sync(quiet = false) {
        if (this.syncing) {
          if (quiet) return
          setText(this.statusW, 'Already syncing…')
          setTimeout(() => this.alive && this.syncing && setText(this.statusW, 'Syncing…'), 1500)
          return
        }
        this.syncing = true
        setText(this.statusW, 'Syncing…')
        sync((m, p, t) => ask(this, m, p, t), null, { full: !quiet })
          .catch(() => ({ ok: false, error: 'Phone not reachable' }))
          .then((r) => {
            this.syncing = false
            if (!this.alive) return
            if (!r.ok) {
              setText(this.statusW, `Sync failed: ${r.error || 'no reply'}`)
              return
            }
            const parts = [r.total ? `${r.targets} of ${r.total} devices` : `${r.targets || 0} devices`]
            if (r.areas !== undefined) parts.push(`${r.areas} areas`)
            if (r.paints !== undefined) parts.push(`${r.paints} painted`)
            if (r.rooms) parts.push(`${r.rooms} rooms`)
            setText(this.statusW, parts.join(' · '))
            if (this.syncW) setLabel(this.syncW, `Sync (${targets().length})`)
          })
      },
    }),
  ),
)
