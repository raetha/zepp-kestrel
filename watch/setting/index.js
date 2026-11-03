// Settings page shown in the Zepp phone app: store installs, and test builds installed
// from a real `zeus preview` QR code (Developer Mode → the app → Settings; our own .zpk
// QR codes get none). Shows and changes the watch's settings, which live in Home
// Assistant (the side service sends changes there; the watch picks them up when it
// next syncs), which builds are running, and M0 probe results. Kestrel needs its Home
// Assistant integration: the watch pairs with it from the watch.
//
// The Zepp app renders this like a small web page: View/Text/Toggle/Select/Button
// take CSS-like `style` objects. Its Select shows no value in the field, and hands
// the choice back as text, JSON text or { value }: see choice() and picked().

import { BUILD } from '../lib/version.js'

const SETTINGS_KEY = 'kestrel.settings'
const EDIT_KEY = 'kestrel.settingsEdit'
const EDIT_RESULT_KEY = 'kestrel.settingsResult'
const SIDE_BUILD_KEY = 'kestrel.sideBuild' // written by the side service when it starts

const GESTURES = [
  { name: 'Wrist flick', value: 'flick' },
  { name: 'Finger snap', value: 'snap' },
  { name: 'Finger tap', value: 'tap' },
]
const ROOM_SOURCES = [
  { name: 'Watch (Bluetooth)', value: 'watch' },
  { name: 'Home Assistant sensor', value: 'sensor' },
]
// Option values are strings: the Zepp app's Select matches and returns strings
const numbers = (list, unit) => list.map((v) => ({ name: `${v}${unit}`, value: String(v) }))
const DWELL_SECONDS = numbers([1, 1.5, 2, 2.5, 3, 4, 5, 7, 10], ' s')
const VOLUME_MAX = numbers([20, 30, 40, 50, 60, 70, 80, 100], '%')
const VOLUME_STEP = numbers([5, 10, 15, 20, 30, 50], '%')
const SCREEN_SECONDS = numbers([10, 15, 20, 30, 45, 60, 90, 120], ' s')

// ---------------------------------------------------------------- look
// Kestrel's colours (the logo's rufous orange, as on the watch), on a light page.
const C = {
  page: '#F5F2EF',
  card: '#FFFFFF',
  accent: '#D9622B',
  accentSoft: '#FBEDE6',
  text: '#1F1A17',
  quiet: '#6E6560',
  line: '#ECE6E1',
  good: '#1E7A46',
  goodSoft: '#E6F4EC',
  warn: '#9A5B00',
  warnSoft: '#FFF4DE',
}
const S = {
  page: { padding: '16px 12px 28px', backgroundColor: C.page, minHeight: '100%' },
  header: { width: '100%', maxWidth: '440px', margin: '0 auto 14px', textAlign: 'center' },
  title: { display: 'block', width: '100%', fontSize: '24px', fontWeight: 'bold', color: C.accent, textAlign: 'center' },
  subtitle: { display: 'block', width: '100%', marginTop: '4px', fontSize: '14px', color: C.quiet, textAlign: 'center' },
  card: {
    width: '100%',
    maxWidth: '440px',
    margin: '0 auto 14px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: C.card,
    borderRadius: '16px',
    boxSizing: 'border-box',
  },
  cardTitle: { display: 'block', width: '100%', marginBottom: '6px', fontSize: '18px', fontWeight: 'bold', color: C.text },
  label: { fontSize: '16px', color: C.text },
  helper: { display: 'block', width: '100%', marginTop: '2px', marginBottom: '10px', fontSize: '14px', lineHeight: '19px', color: C.quiet },
  body: { display: 'block', width: '100%', fontSize: '14px', lineHeight: '19px', color: C.text },
  status: (ok) => ({
    display: 'block',
    width: '100%',
    marginTop: '4px',
    padding: '10px 12px',
    borderRadius: '10px',
    boxSizing: 'border-box',
    fontSize: '14px',
    lineHeight: '19px',
    color: ok ? C.good : C.warn,
    backgroundColor: ok ? C.goodSoft : C.warnSoft,
  }),
  button: {
    width: '100%',
    marginTop: '12px',
    padding: '10px',
    backgroundColor: C.accentSoft,
    color: C.accent,
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: '600',
    textAlign: 'center',
  },
}

const text = (style, value) => Text({ paragraph: true, style }, value)
const card = (title, children, helper = null) =>
  View({ style: S.card }, [...(title ? [text(S.cardTitle, title)] : []), ...(helper ? [text(S.helper, helper)] : []), ...children])

// ---------------------------------------------------------------- storage
function readJson(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key) || 'null') || fallback
  } catch (e) {
    return fallback
  }
}

/** Ask the side service to change one setting ({ group: { field: value } }). */
function change(storage, group, field, value) {
  storage.setItem(EDIT_KEY, JSON.stringify({ settings: { [group]: { [field]: value } }, at: Date.now() }))
}

/** A Select's choice, whichever shape the Zepp app hands it back in (text, JSON text, { value }). */
function picked(x) {
  let v = x
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch (e) {
      // plain text
    }
  }
  if (v && typeof v === 'object') v = v.value
  return v === undefined || v === null ? '' : String(v)
}

/**
 * A drop-down whose label says the current choice ("Gesture: Wrist flick"): the iPhone
 * Zepp app shows a Select's field empty even with a value (Lifto Companion's page does
 * the same). A value that isn't among the options (one set in Home Assistant, like 25 s)
 * is shown as it is.
 */
function choice({ label, options, value, unit = '', numeric = false, onChange }) {
  const v = value === undefined || value === null ? '' : String(value)
  const hit = options.find((o) => o.value === v)
  const shown = hit ? hit.name : v ? `${v}${unit}` : 'not set'
  return Select({
    label: `${label}: ${shown}`,
    labelStyle: S.label,
    options,
    value: v,
    onChange: (x) => {
      const p = picked(x)
      if (!p) return
      if (numeric) {
        const n = Number(p)
        if (Number.isFinite(n)) onChange(n)
      } else onChange(p)
    },
  })
}

const toggle = (label, value, onChange) => Toggle({ label, labelStyle: S.label, value: !!value, onChange })

// ---------------------------------------------------------------- sections
/** Which builds run here: this page (installed with the phone side) and the side service actually running. */
function builds(s) {
  const side = s.getItem(SIDE_BUILD_KEY)
  const same = side === BUILD
  return card('Version', [
    text(S.body, `Kestrel ${BUILD} (this settings page and the phone part)`),
    text(
      S.status(same),
      same
        ? `The phone part running now is the same build.`
        : side
          ? `The phone part running now is ${side}. The Zepp app keeps the first one it installed: reinstall the Zepp app, then install Kestrel again, to run ${BUILD}.`
          : `The phone part hasn't reported its build yet: open Kestrel on the watch.`,
    ),
  ])
}

function watchSettings(s) {
  const cur = readJson(s, SETTINGS_KEY, null)
  if (!cur) {
    return [
      card('Watch settings', [
        text(S.body, 'Pair the watch with the Kestrel integration in Home Assistant, then open Kestrel on the watch once: its settings show up here.'),
      ]),
    ]
  }
  const g = cur.gesture || {}
  const d = cur.dwell || {}
  const r = cur.room || {}
  const v = cur.volume || { max: 80, step: 20 }
  const result = s.getItem(EDIT_RESULT_KEY)
  return [
    card(
      'Triggering',
      [
        toggle('Gesture trigger', g.enabled, (x) => change(s, 'gesture', 'enabled', x)),
        choice({ label: 'Gesture', options: GESTURES, value: g.kind, onChange: (x) => change(s, 'gesture', 'kind', x) }),
        toggle('Instant toggle', d.enabled, (x) => change(s, 'dwell', 'enabled', x)),
        choice({ label: 'Hold for', options: DWELL_SECONDS, value: d.seconds, unit: ' s', numeric: true, onChange: (x) => change(s, 'dwell', 'seconds', x) }),
      ],
      'Instant toggle triggers a device just by holding the aim on it.',
    ),
    card('Watch', [
      toggle('Open on Point (for the shortcut key)', cur.start && cur.start.point, (x) => change(s, 'start', 'point', x)),
      choice({
        label: 'Screen stays on',
        options: SCREEN_SECONDS,
        value: (cur.screen && cur.screen.seconds) || 30,
        unit: ' s',
        numeric: true,
        onChange: (x) => change(s, 'screen', 'seconds', x),
      }),
      toggle('Learn from use', !cur.learn || cur.learn.enabled !== false, (x) => change(s, 'learn', 'enabled', x)),
      choice({ label: 'Current room from', options: ROOM_SOURCES, value: r.source, onChange: (x) => change(s, 'room', 'source', x) }),
    ]),
    card(
      'Media volume',
      [
        choice({ label: 'Limit', options: VOLUME_MAX, value: v.max, unit: '%', numeric: true, onChange: (x) => change(s, 'volume', 'max', x) }),
        choice({ label: 'Change per twist', options: VOLUME_STEP, value: v.step, unit: '%', numeric: true, onChange: (x) => change(s, 'volume', 'step', x) }),
      ],
      'Twisting at a media player never raises it above the limit; turning it down always works.',
    ),
    card('', [
      text(
        result ? S.status(/^Saved/.test(result)) : S.helper,
        result || 'Changes go to Home Assistant; the watch picks them up when it next syncs. Gesture thresholds and the room sensor: Home Assistant → Kestrel → Configure.',
      ),
    ]),
  ]
}

function describe(e) {
  switch (e.test) {
    case 'rates':
      return (e.results || []).map((r) => `${r.sensor}${r.mode ? ' ' + r.mode : ''}: ${r.hz} Hz (${r.distinctHz} new)`).join(' · ')
    case 'snap':
      return `${e.gesture}: ${e.hz} Hz accel, ${e.gyroHz} Hz gyro, peak ${e.peakDev}, width ${e.widthMs} ms, gyro ${e.gyroPeak}°/s`
    case 'tilt':
      return `${e.recording || e.pose || 'tilt'}: ${(e.phases || []).map((p) => `${p.phase} ${p.heading}°`).join(', ') || `${e.heading}°`}`
    case 'ble':
      return `${e.room}: ${e.total} heard, ${e.stable} stable`
    case 'latency':
      return e.haError
        ? `watch↔phone p50 ${e.watchPhoneMs.p50} ms; HA error: ${e.haError}`
        : `watch↔phone p50 ${e.watchPhoneMs.p50} ms · phone↔HA p50 ${e.phoneHaMs.p50} ms · total p50 ${e.totalMs.p50} / p90 ${e.totalMs.p90} ms`
    default:
      return JSON.stringify(e)
  }
}

function probes(s) {
  const log = readJson(s, 'probeLog', [])
  return card(
    `Probe results (${log.length})`,
    [
      ...log.map((e) =>
        View({ style: { marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${C.line}` } }, [
          Text({ bold: true, style: S.body }, `${e.test} · ${new Date(e.at).toLocaleTimeString()}`),
          text(S.helper, describe(e)),
        ]),
      ),
      Button({ label: 'Clear results', style: S.button, onClick: () => s.setItem('clearLog', String(Date.now())) }),
    ],
    log.length ? null : 'Measurements from More → Probes on the watch show up here.',
  )
}

AppSettingsPage({
  build(props) {
    const s = props.settingsStorage
    return View({ style: S.page }, [
      View({ style: S.header }, [text(S.title, 'Kestrel'), text(S.subtitle, 'Point at a device, trigger it')]),
      builds(s),
      ...watchSettings(s),
      probes(s),
    ])
  },
})
