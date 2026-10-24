// Side service: runs inside the Zepp app on the phone. The only part of
// WristWand that talks to Home Assistant (lib/ha-client.js does the work).

import { BaseSideService } from '@zeppos/zml/base-side'
import { METHOD, Dedupe } from '../lib/protocol.js'
import { HaClient } from '../lib/ha-client.js'
import { haConfig, haPing, detectComponent, fireEvent } from './ha.js'

const LOG_KEY = 'probeLog'
const LOG_MAX = 40
const LOG_MAX_CHARS = 20000
const SUMMARY_MAX_CHARS = 400

/** A probe result small enough for phone storage: drop raw traces and trails. */
function summarize(entry) {
  const { raw, trail, devices, results, phases, ...rest } = entry || {}
  const summary = { ...rest }
  if (trail) summary.trailEntries = trail.length
  if (devices) summary.devices = devices.length
  if (results) summary.results = results.length
  if (phases) summary.phases = phases.map((p) => `${p.phase}: ${p.heading}`)
  const text = JSON.stringify(summary)
  return text.length > SUMMARY_MAX_CHARS ? { test: summary.test, at: summary.at } : summary
}

function readLog(settings) {
  try {
    const text = settings.getItem(LOG_KEY) || '[]'
    if (text.length > LOG_MAX_CHARS) return []
    const log = JSON.parse(text)
    return Array.isArray(log) ? log : []
  } catch (e) {
    return []
  }
}

const dedupe = new Dedupe()

AppSideService(
  BaseSideService({
    onInit() {
      this.ha = new HaClient({ fetch: (req) => this.fetch(req), store: this.settings })
      // Earlier builds could fill phone storage with large probe summaries.
      try {
        const text = this.settings.getItem(LOG_KEY)
        if (text && text.length > LOG_MAX_CHARS) this.settings.setItem(LOG_KEY, '[]')
      } catch (e) {
        // leave it
      }
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
            return { found: await this.ha.discover(p.address ? [p.address] : []) }
          case METHOD.PAIR_START:
            return this.ha.pairStart(p.url, p.watchName)
          case METHOD.PAIR_CONFIRM:
            return this.ha.pairConfirm(p.url, p.pairingId, p.code)
          case METHOD.UNPAIR:
            this.ha.unpair()
            return { ok: true }
          case METHOD.SYNC:
            return this.ha.sync(p.only || null, p.have || null)
          case METHOD.FIRE:
            // the watch may retry over Bluetooth; never run a command twice
            if (p.seq !== undefined && !dedupe.accept(p.seq)) return { ok: true, duplicate: true }
            return this.ha.fire(p)

          case METHOD.SAVE:
            if (p.section !== 'paints' && p.section !== 'rooms') throw new Error('unknown section')
            return this.ha.saveSection(p.section, p.value || {})
          case METHOD.SAVE_GESTURE:
            return this.ha.saveGesture(p.gesture || {})
          case METHOD.ROOM:
            return { room: await this.ha.room() }

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
      // Home Assistant first: it keeps the full result (raw traces included).
      // Paired with the component: always. Direct mode: only if the settings page says so.
      let forwarded = false
      let error = null
      try {
        if (this.ha.status().mode === 'component') {
          await this.ha.component('/api/wristwand/probe', { method: 'POST', body: entry })
          forwarded = true
        } else {
          const cfg = haConfig(this.settings)
          if (cfg && this.settings.getItem('forwardToHa') === 'true') {
            forwarded = !!(await fireEvent(this, cfg, 'wristwand_probe', entry))
          }
        }
      } catch (e) {
        error = `Home Assistant: ${(e && e.message) || e}`
      }

      // Then a small summary on the phone, for the settings page's list. Phone
      // storage is small: an oversized log (from earlier builds) is reset.
      let stored = false
      try {
        const log = readLog(this.settings)
        log.unshift(summarize(entry))
        let text = JSON.stringify(log.slice(0, LOG_MAX))
        if (text.length > LOG_MAX_CHARS) text = JSON.stringify(log.slice(0, 5))
        this.settings.setItem(LOG_KEY, text)
        stored = true
      } catch (e) {
        try {
          this.settings.setItem(LOG_KEY, '[]')
        } catch (e2) {
          // leave it
        }
        if (!error && !forwarded) error = `Phone storage: ${(e && e.message) || e}`
      }
      return { stored, forwarded, error }
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
