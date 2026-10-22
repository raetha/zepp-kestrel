// Side service: runs inside the Zepp app on the phone. Answers the watch,
// talks to Home Assistant, and keeps probe results where the settings page
// (and optionally HA) can show them.

import { BaseSideService } from '@zeppos/zml/base-side'
import { METHOD } from '../lib/protocol.js'
import { haConfig, haPing, detectComponent, fireEvent } from './ha.js'

const LOG_KEY = 'probeLog'
const LOG_MAX = 40

function readLog(settings) {
  try {
    return JSON.parse(settings.getItem(LOG_KEY) || '[]')
  } catch (e) {
    return []
  }
}

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      const handle = async () => {
        switch (req.method) {
          case METHOD.PING:
            return { t: Date.now() }

          case METHOD.HA_PING: {
            const cfg = haConfig(this.settings)
            if (!cfg) return { error: 'Set HA URL + token in settings' }
            try {
              return await haPing(this, cfg)
            } catch (e) {
              return { error: `HA unreachable: ${(e && e.message) || e}` }
            }
          }

          case METHOD.PROBE_LOG:
            return this.storeProbe(req.params || {})

          default:
            throw new Error(`unknown method ${req.method}`)
        }
      }
      handle().then(
        (result) => res(null, result),
        (err) => res({ message: String((err && err.message) || err) }),
      )
    },

    async storeProbe(entry) {
      // Raw traces are too big for settings storage; keep a summary there.
      const { raw, devices, ...summary } = entry
      if (devices) summary.devices = devices.slice(0, 12)
      const log = readLog(this.settings)
      log.unshift(summary)
      this.settings.setItem(LOG_KEY, JSON.stringify(log.slice(0, LOG_MAX)))

      let forwarded = false
      const cfg = haConfig(this.settings)
      if (cfg && this.settings.getItem('forwardToHa') === 'true') {
        // Full entry, raw traces included, as an HA event. Listen for
        // `wristwand_probe` in Developer tools > Events to see them.
        forwarded = await fireEvent(this, cfg, 'wristwand_probe', entry).catch(() => false)
      }
      return { stored: true, forwarded }
    },

    // The settings page talks to us through settings storage keys.
    onSettingsChange({ key }) {
      if (key === 'haTest') this.testHa()
      if (key === 'clearLog') this.settings.setItem(LOG_KEY, '[]')
    },

    async testHa() {
      const cfg = haConfig(this.settings)
      let msg
      if (!cfg) {
        msg = 'Enter a URL and token first.'
      } else {
        try {
          const p = await haPing(this, cfg)
          if (!p.ok) {
            msg = p.error
          } else {
            const comp = await detectComponent(this, cfg)
            msg = `Connected in ${p.haMs} ms. ${comp ? `Wristwand component ${comp.version || ''} found.` : 'Direct mode (component not installed).'}`
          }
        } catch (e) {
          msg = `Could not reach HA: ${(e && e.message) || e}`
        }
      }
      this.settings.setItem('haTestResult', msg)
    },
  }),
)
