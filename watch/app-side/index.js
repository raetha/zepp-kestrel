// Side service: runs inside the Zepp app on the phone. The only part of
// WristWand that talks to Home Assistant (lib/ha-client.js does the work).

import { BaseSideService } from '@zeppos/zml/base-side'
import { METHOD, Dedupe } from '../lib/protocol.js'
import { HaClient } from '../lib/ha-client.js'
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

const dedupe = new Dedupe()

AppSideService(
  BaseSideService({
    onInit() {
      this.ha = new HaClient({ fetch: (req) => this.fetch(req), store: this.settings })
    },

    onRequest(req, res) {
      const p = req.params || {}
      const handle = async () => {
        switch (req.method) {
          case METHOD.PING:
            return { t: Date.now() }

          case METHOD.STATUS:
            return this.ha.status()
          case METHOD.DISCOVER:
            return { found: await this.ha.discover() }
          case METHOD.PAIR_START:
            return this.ha.pairStart(p.url, p.watchName)
          case METHOD.PAIR_CONFIRM:
            return this.ha.pairConfirm(p.url, p.pairingId, p.code)
          case METHOD.UNPAIR:
            this.ha.unpair()
            return { ok: true }
          case METHOD.SYNC:
            return { targets: await this.ha.targets() }
          case METHOD.FIRE:
            // the watch may retry over Bluetooth; never run a command twice
            if (p.seq !== undefined && !dedupe.accept(p.seq)) return { ok: true, duplicate: true }
            return this.ha.fire(p)

          case METHOD.HA_PING:
            return this.haPing()
          case METHOD.PROBE_LOG:
            return this.storeProbe(p)
          default:
            throw new Error(`unknown method ${req.method}`)
        }
      }
      handle().then(
        (result) => res(null, result),
        (err) => res(null, { ok: false, error: String((err && err.message) || err) }),
      )
    },

    // M0 latency probe: time a round trip to HA (paired or direct)
    async haPing() {
      const st = this.ha.status()
      if (st.mode === 'component') {
        const t0 = Date.now()
        await this.ha.component('/api/wristwand/targets')
        return { ok: true, haMs: Date.now() - t0 }
      }
      const cfg = haConfig(this.settings)
      if (!cfg) return { error: 'Pair with Home Assistant first' }
      try {
        return await haPing(this, cfg)
      } catch (e) {
        return { error: `HA unreachable: ${(e && e.message) || e}` }
      }
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
        forwarded = await fireEvent(this, cfg, 'wristwand_probe', entry).catch(() => false)
      }
      return { stored: true, forwarded }
    },

    // The settings page (store installs) talks to us through settings storage keys.
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
            msg = `Connected in ${p.haMs} ms. ${comp ? `WristWand component ${comp.version || ''} found: pair from the watch.` : 'Direct mode (component not installed).'}`
          }
        } catch (e) {
          msg = `Could not reach HA: ${(e && e.message) || e}`
        }
      }
      this.settings.setItem('haTestResult', msg)
    },
  }),
)
