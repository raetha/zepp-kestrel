// Side service: runs inside the Zepp app on the phone. The only part of
// Kestrel that talks to Home Assistant (lib/ha-client.js does the work).

import { BaseSideService } from '@zeppos/zml/base-side'
import { METHOD, Dedupe } from '../lib/protocol.js'
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

const dedupe = new Dedupe()

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
          case METHOD.TAKE_OVER:
            return this.ha.takeOver(String(p.from || ''))
          case METHOD.UNPAIR:
            this.ha.unpair()
            return { ok: true }
          case METHOD.SYNC:
            return this.mirror(await this.ha.sync(p.only || null, p.have || null, p.version || null, p.deviceId || null))
          case METHOD.FIRE:
            // the watch may retry over Bluetooth; never run a command twice
            if (p.seq !== undefined && !dedupe.accept(p.seq)) return { ok: true, duplicate: true }
            return this.ha.fire(p)

          case METHOD.SAVE:
            if (p.section !== 'paints' && p.section !== 'rooms') throw new Error('unknown section')
            return this.ha.saveChanges(p.section, p.changes || {}, p.base)
          case METHOD.SAVE_SETTINGS:
            return this.mirror(await this.ha.saveSettings(p.settings || {}))
          case METHOD.ROOM:
            return { room: await this.ha.room(p.here || null) }

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

    // M0 latency probe: time a round trip to Home Assistant
    async haPing() {
      if (!this.ha.status().paired) return { error: 'Pair with Home Assistant first' }
      try {
        return await this.ha.ping()
      } catch (e) {
        return { error: (e && e.message) || String(e) }
      }
    },

    async storeProbe(entry) {
      // Home Assistant first: it keeps the full result (raw traces included).
      let forwarded = false
      let error = null
      try {
        if (this.ha.status().paired) {
          await this.ha.probe(entry)
          forwarded = true
        }
      } catch (e) {
        error = `Home Assistant: ${(e && e.message) || e}`
      }

      // Then a small summary on the phone, for the settings page's list (probes run on
      // purpose only: not the aim traces and trails recorded as the app is used). Phone
      // storage is small: if the log can't be written, it's reset.
      let stored = false
      if (entry && ['point', 'trail', 'paint'].includes(entry.test)) return { stored, forwarded, error }
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
        const r = this.mirror(await this.ha.saveSettings(edit.settings))
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
