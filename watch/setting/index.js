// Settings page shown in the Zepp phone app (store installs only: sideloaded
// test builds don't get one). Shows and changes the watch's settings, which
// live in Home Assistant (the side service sends changes there; the watch
// picks them up when it next syncs), and shows M0 probe results. Kestrel needs
// its Home Assistant integration: the watch pairs with it from the watch.

const SETTINGS_KEY = 'kestrel.settings'
const EDIT_KEY = 'kestrel.settingsEdit'
const EDIT_RESULT_KEY = 'kestrel.settingsResult'
const GESTURES = [
  { name: 'Wrist flick', value: 'flick' },
  { name: 'Finger snap', value: 'snap' },
  { name: 'Finger tap', value: 'tap' },
]
const ROOM_SOURCES = [
  { name: 'Watch (Bluetooth)', value: 'watch' },
  { name: 'Home Assistant sensor', value: 'sensor' },
]
const DWELL_SECONDS = [1, 1.5, 2, 2.5, 3, 4, 5, 7, 10].map((v) => ({ name: `${v} s`, value: v }))
const VOLUME_MAX = [20, 30, 40, 50, 60, 70, 80, 100].map((v) => ({ name: `${v}%`, value: v }))
const VOLUME_STEP = [5, 10, 15, 20, 30, 50].map((v) => ({ name: `${v}%`, value: v }))

function readSettings(storage) {
  try {
    return JSON.parse(storage.getItem(SETTINGS_KEY) || 'null')
  } catch (e) {
    return null
  }
}

/** Ask the side service to change one setting ({ group: { field: value } }). */
function change(storage, group, field, value) {
  storage.setItem(EDIT_KEY, JSON.stringify({ settings: { [group]: { [field]: value } }, at: Date.now() }))
}

function watchSettings(s) {
  const cur = readSettings(s)
  if (!cur) {
    return Section({ title: 'Watch settings' }, [
      Text({}, ['Pair the watch with the Kestrel integration in Home Assistant, then open Kestrel on the watch once: its settings show up here.']),
    ])
  }
  const g = cur.gesture || {}
  const d = cur.dwell || {}
  const r = cur.room || {}
  const v = cur.volume || { max: 60, step: 20 }
  return Section({ title: 'Watch settings' }, [
    Toggle({ label: 'Gesture trigger', value: !!g.enabled, onChange: (v) => change(s, 'gesture', 'enabled', v) }),
    Select({ label: 'Gesture', options: GESTURES, value: g.kind, onChange: (v) => change(s, 'gesture', 'kind', v) }),
    Toggle({
      label: 'Instant toggle: trigger by holding the aim on a device',
      value: !!d.enabled,
      onChange: (v) => change(s, 'dwell', 'enabled', v),
    }),
    Select({ label: 'Hold for', options: DWELL_SECONDS, value: d.seconds, onChange: (v) => change(s, 'dwell', 'seconds', Number(v)) }),
    Select({ label: 'Current room from', options: ROOM_SOURCES, value: r.source, onChange: (x) => change(s, 'room', 'source', x) }),
    Toggle({
      label: 'Open on Point (for the shortcut key)',
      value: !!(cur.start && cur.start.point),
      onChange: (x) => change(s, 'start', 'point', x),
    }),
    Toggle({
      label: 'Learn from use',
      value: !cur.learn || cur.learn.enabled !== false,
      onChange: (x) => change(s, 'learn', 'enabled', x),
    }),
    Select({ label: 'Volume limit (twisting never goes above)', options: VOLUME_MAX, value: v.max, onChange: (x) => change(s, 'volume', 'max', Number(x)) }),
    Select({ label: 'Volume change per twist', options: VOLUME_STEP, value: v.step, onChange: (x) => change(s, 'volume', 'step', Number(x)) }),
    row([Text({}, [s.getItem(EDIT_RESULT_KEY) || 'Gesture thresholds and the room sensor: Home Assistant → Kestrel → Configure.'])]),
  ])
}

function readLog(storage) {
  try {
    return JSON.parse(storage.getItem('probeLog') || '[]')
  } catch (e) {
    return []
  }
}

function describe(e) {
  switch (e.test) {
    case 'rates':
      return (e.results || []).map((r) => `${r.sensor}${r.mode ? ' ' + r.mode : ''}: ${r.hz} Hz (${r.distinctHz} new)`).join(' · ')
    case 'snap':
      return `${e.gesture}: ${e.hz} Hz accel, ${e.gyroHz} Hz gyro, peak ${e.peakDev}, width ${e.widthMs} ms, gyro ${e.gyroPeak}°/s`
    case 'tilt':
      return `${e.pose}: ${e.heading}° ±${e.spread}, pitch ${e.pitch}°, roll ${e.roll}°${e.delta === null ? '' : `, Δ ${e.delta}°`}`
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

const row = (children) => View({ style: { marginTop: '12px' } }, children)

AppSettingsPage({
  build(props) {
    const s = props.settingsStorage
    const log = readLog(s)

    return View({ style: { padding: '12px 16px' } }, [
      watchSettings(s),

      Section({ title: `Probe results (${log.length})` }, [
        ...log.map((e) =>
          row([
            Text({ bold: true }, [`${e.test} · ${new Date(e.at).toLocaleTimeString()}`]),
            Text({}, [describe(e)]),
          ]),
        ),
        row([
          Button({
            label: 'Clear results',
            onClick: () => s.setItem('clearLog', String(Date.now())),
          }),
        ]),
      ]),
    ])
  },
})
