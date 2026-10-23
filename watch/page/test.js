// Hosts one M0 probe (chosen by the params string from the menu) and gives
// it a small context: a status text, two buttons, sending results to the
// phone, and cleanup on exit. The SELECT key also presses the main button;
// BACK returns to the probe list.
//
// Probes run async loops that can outlive the page (the user presses back
// mid-run, or a reply from the phone arrives late). Once the page is gone,
// every ctx call is a no-op, so nothing touches deleted widgets.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { prop } from '@zos/ui'
import { text, setText, button, setLabel, ask, listenKeys, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'

import { ratesProbe } from './probes/rates.js'
import { snapProbe } from './probes/snap.js'
import { tiltProbe } from './probes/tilt.js'
import { bleProbe } from './probes/ble.js'
import { latencyProbe } from './probes/latency.js'

const PROBES = {
  rates: ratesProbe,
  snap: snapProbe,
  tilt: tiltProbe,
  ble: bleProbe,
  latency: latencyProbe,
}

Page(
  BasePage(
    tracked('test', {
      onInit(params) {
        this.mode = typeof params === 'string' && PROBES[params] ? params : 'rates'
        this.alive = true
        this.cleanups = []
        this.onPrimary = null
        this.onSecondary = null
        // Keep the app open while the wrist moves around during a test.
        pauseDropWristScreenOff({ duration: 0 })
      },

      build() {
        const page = this
        const probe = PROBES[this.mode]
        const live = (fn) => (...args) => (page.alive ? fn(...args) : undefined)

        this.titleW = text({ y: 36, h: 40, size: 28, value: probe.title })
        this.bodyW = text({ x: 56, y: 86, w: 368, h: 206, size: 21, value: '' })
        this.sentW = text({ x: 90, y: 294, w: 300, h: 30, size: 17, color: COLOR.quiet, value: '' })
        this.secondaryW = button({ x: 90, y: 330, w: 300, h: 54, label: '', size: 22, onClick: () => page.onSecondary && page.onSecondary() })
        this.primaryW = button({ x: 120, y: 396, w: 240, h: 56, label: '', primary: true, onClick: () => page.onPrimary && page.onPrimary() })
        this.secondaryW.setProperty(prop.VISIBLE, false)

        this.cleanups.push(listenKeys(() => page.onPrimary && page.onPrimary()))

        const ctx = {
          alive: () => page.alive,
          status: live((s) => setText(page.bodyW, s)),
          primary: live((label, fn) => {
            setLabel(page.primaryW, label)
            if (fn) page.onPrimary = fn
          }),
          secondary: live((label, fn) => {
            page.secondaryW.setProperty(prop.VISIBLE, true)
            setLabel(page.secondaryW, label)
            if (fn) page.onSecondary = fn
          }),
          request: (method, params) => ask(page, method, params, 10000),
          // Send a result to the phone, which keeps a summary and forwards it to
          // Home Assistant when paired. Shows the outcome; never blocks or throws.
          log: (result) => {
            live(setText)(page.sentW, 'Sending…')
            return ask(page, METHOD.PROBE_LOG, { ...result, test: page.mode, at: Date.now() }, 15000)
              .then((r) => {
                const msg = r && r.forwarded ? 'Sent to Home Assistant' : r && r.stored ? 'Saved on the phone only' : `Not sent: ${(r && r.error) || 'no reply'}`
                live(setText)(page.sentW, msg)
                return r
              })
              .catch(() => {
                live(setText)(page.sentW, 'Not sent: phone not reachable')
                return null
              })
          },
          onCleanup: (fn) => page.cleanups.push(fn),
          color: COLOR,
        }

        probe.start(ctx)
      },

      onDestroy() {
        this.alive = false
        for (const fn of this.cleanups) {
          try {
            fn()
          } catch (e) {
            // keep cleaning up
          }
        }
        resetDropWristScreenOff()
      },
    }),
  ),
)
