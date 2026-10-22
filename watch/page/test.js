// Hosts one M0 probe (chosen by the params string from the menu) and gives
// it a small context: a status text, two buttons, logging to the phone, and
// cleanup on exit. The SELECT key also presses the main button.

import { BasePage } from '@zeppos/zml/base-page'
import { pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { onKey, offKey, KEY_SELECT, KEY_EVENT_CLICK } from '@zos/interaction'
import { prop } from '@zos/ui'
import { text, setText, button, setLabel, COLOR } from './ui.js'
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
  BasePage({
    onInit(params) {
      this.mode = typeof params === 'string' && PROBES[params] ? params : 'rates'
      this.cleanups = []
      this.onPrimary = null
      this.onSecondary = null
      // Keep the app open while the wrist moves around during a test.
      pauseDropWristScreenOff({ duration: 0 })
    },

    build() {
      const page = this
      const probe = PROBES[this.mode]

      this.titleW = text({ y: 36, h: 40, size: 28, value: probe.title })
      this.bodyW = text({ x: 56, y: 86, w: 368, h: 236, size: 21, value: '' })
      this.secondaryW = button({ x: 90, y: 330, w: 300, h: 54, label: '', size: 22, onClick: () => page.onSecondary && page.onSecondary() })
      this.primaryW = button({ x: 120, y: 396, w: 240, h: 56, label: '', primary: true, onClick: () => page.onPrimary && page.onPrimary() })
      this.secondaryW.setProperty(prop.VISIBLE, false)

      onKey({
        callback: (key, event) => {
          if (key === KEY_SELECT && event === KEY_EVENT_CLICK && page.onPrimary) {
            page.onPrimary()
            return true
          }
          return false
        },
      })

      const ctx = {
        status: (s) => setText(page.bodyW, s),
        primary: (label, fn) => {
          setLabel(page.primaryW, label)
          if (fn) page.onPrimary = fn
        },
        secondary: (label, fn) => {
          page.secondaryW.setProperty(prop.VISIBLE, true)
          setLabel(page.secondaryW, label)
          if (fn) page.onSecondary = fn
        },
        request: (method, params) => page.request({ method, params }),
        // Send a result to the phone, which stores it (and optionally
        // forwards it to Home Assistant). Never blocks or throws.
        log: (result) =>
          page
            .request({ method: METHOD.PROBE_LOG, params: { ...result, test: page.mode, at: Date.now() } })
            .catch(() => null),
        onCleanup: (fn) => page.cleanups.push(fn),
        color: COLOR,
      }

      probe.start(ctx)
    },

    onDestroy() {
      for (const fn of this.cleanups) {
        try {
          fn()
        } catch (e) {
          // keep cleaning up
        }
      }
      offKey()
      resetDropWristScreenOff()
    },
  }),
)
