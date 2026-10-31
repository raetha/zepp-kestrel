// Side service: runs inside the Zepp app on the phone. Deliberately small: it finds
// Home Assistant, pairs, keeps the watch's token, and relays the requests the watch
// builds (METHOD.RELAY, lib/ha-api.js) to Kestrel's endpoints. The Zepp app doesn't
// always replace this part when a new build is installed (docs/development.md), so
// new features belong on the watch and in Home Assistant, not here.

import { BaseSideService } from '@zeppos/zml/base-side'
import { METHOD } from '../lib/protocol.js'
import { HaApi, relayable } from '../lib/ha-api.js'
import { HaClient } from '../lib/ha-client.js'
import { BUILD } from '../lib/version.js'

const LOG_KEY = 'probeLog'
const LOG_MAX = 40
const LOG_MAX_CHARS = 20000
const SUMMARY_MAX_CHARS = 400
// The settings page (store installs) shows the watch's settings from this copy,
// kept up to date from every sync, and asks for changes through EDIT_KEY.
const SETTINGS_KEY = 'kestrel.settings'
const EDIT_KEY = 'kestrel.settingsEdit'
const EDIT_RESULT_KEY = 'kestrel.settingsResult'

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

AppSideService(
  BaseSideService({
    onInit() {
      // shows in the Zepp app's developer mode log (Profile → Developer Mode → Mini Program → Side Service):
      // which build the phone side really runs (it hasn't always been the one just installed)
      console.log(`Kestrel side service ${BUILD} started`)
      this.ha = new HaClient({ fetch: (req) => this.fetch(req), store: this.settings })
    },

    onRequest(req, res) {
      const p = req.params || {}
      const handle = async () => {
        switch (req.method) {
          case METHOD.PING:
            return { t: Date.now() }

          case METHOD.STATUS:
            // build: this side service's, so the watch can tell a mismatch (lib/version.js)
            return { ...this.ha.status(), build: BUILD }
          case METHOD.DISCOVER:
            return { found: await this.ha.discover(p.address ? [p.address] : []) }
          case METHOD.PAIR_START:
            return this.ha.pairStart(p.url, p.watchName, p.deviceId || null)
          case METHOD.PAIR_CONFIRM:
            return this.ha.pairConfirm(p.url, p.pairingId, p.code)
          case METHOD.UNPAIR:
            this.ha.unpair()
            return { ok: true }

          // Everything else for Home Assistant: the watch builds the request (lib/ha-api.js),
          // this adds the token and tries Home Assistant's known addresses. Kestrel's endpoints only.
          case METHOD.RELAY: {
            const method = p.method || 'GET'
            if (!relayable(p.path, method)) throw new Error('Not a Kestrel request')
            const body = await this.ha.component(p.path, { method, body: p.body })
            this.afterRelay(p.path, p.body, body)
            return { relayed: true, body }
          }

          case METHOD.HA_PING:
            return this.haPing()
          default:
            throw new Error(`unknown method ${req.method}`)
        }
      }
      handle().then(
        (result) => res(null, result),
        (err) => res(null, { ok: false, error: String((err && err.message) || err) }),
      )
    },

    // M0 latency probe: time a round trip to Home Assistant
    async haPing() {
      if (!this.ha.status().paired) return { error: 'Pair with Home Assistant first' }
      try {
        return await this.ha.ping()
      } catch (e) {
        return { error: (e && e.message) || String(e) }
      }
    },

    /** After a relayed request: keep the settings page's copies current. Never fails the request. */
    afterRelay(path, sent, body) {
      if (path.startsWith('/api/kestrel/sync') || path === '/api/kestrel/settings') this.mirror(body)
      if (path === '/api/kestrel/probe') this.logProbe(sent)
    },

    /**
     * A small summary of a probe result on the phone, for the settings page's list (probes run
     * on purpose only: not the aim traces, sweeps and trails recorded as the app is used). Home
     * Assistant keeps the full result. Phone storage is small: if the log can't be written, it's reset.
     */
    logProbe(entry) {
      if (!entry || ['point', 'trail', 'paint'].includes(entry.test)) return
      try {
        const log = readLog(this.settings)
        log.unshift(summarize(entry))
        let text = JSON.stringify(log.slice(0, LOG_MAX))
        if (text.length > LOG_MAX_CHARS) text = JSON.stringify(log.slice(0, 5))
        this.settings.setItem(LOG_KEY, text)
      } catch (e) {
        try {
          this.settings.setItem(LOG_KEY, '[]')
        } catch (e2) {
          // leave it
        }
      }
    },

    // The settings page (store installs) talks to us through settings storage keys.
    onSettingsChange({ key }) {
      if (key === 'clearLog') this.settings.setItem(LOG_KEY, '[]')
      if (key === EDIT_KEY) this.applySettingsEdit()
    },

    /** Keep the settings page's copy of the watch's settings current. Never fails the request. */
    mirror(result) {
      try {
        if (result && result.settings) {
          const text = JSON.stringify(result.settings)
          if (this.settings.getItem(SETTINGS_KEY) !== text) this.settings.setItem(SETTINGS_KEY, text)
        }
      } catch (e) {
        // the page just shows older values
      }
      return result
    },

    /** A change made on the settings page: send it to Home Assistant; the watch gets it on its next sync. */
    async applySettingsEdit() {
      let edit = null
      try {
        edit = JSON.parse(this.settings.getItem(EDIT_KEY) || 'null')
      } catch (e) {
        edit = null
      }
      if (!edit || typeof edit.settings !== 'object') return
      let msg
      try {
        const api = new HaApi((path, opts) => this.ha.component(path, opts))
        const r = this.mirror(await api.saveSettings({ settings: edit.settings }))
        msg = r.ok ? 'Saved. The watch picks it up when it next syncs.' : `Not saved: ${r.error}`
      } catch (e) {
        msg = `Not saved: ${(e && e.message) || e}`
      }
      try {
        this.settings.setItem(EDIT_RESULT_KEY, msg)
      } catch (e) {
        // nothing more to do
      }
    },
  }),
)
