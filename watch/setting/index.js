// Settings page shown in the Zepp phone app. Stores HA connection details
// (they never leave the phone) and shows M0 probe results.

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
      Section({ title: 'Home Assistant' }, [
        TextInput({
          label: 'Home Assistant URL',
          placeholder: 'http://homeassistant.local:8123',
          value: s.getItem('haUrl') || '',
          onChange: (v) => s.setItem('haUrl', v),
        }),
        TextInput({
          label: 'Long-lived access token',
          // The saved token is never shown; type a new one to replace it.
          placeholder: s.getItem('haToken') ? 'Saved — enter a new token to replace' : 'Profile > Security > Create token',
          value: '',
          onChange: (v) => {
            if (v && v.trim()) s.setItem('haToken', v.trim())
          },
        }),
        Toggle({
          label: 'Send probe results to HA as kestrel_probe events',
          value: s.getItem('forwardToHa') === 'true',
          onChange: (v) => s.setItem('forwardToHa', v ? 'true' : 'false'),
        }),
        row([
          Button({
            label: 'Test connection',
            color: 'primary',
            onClick: () => s.setItem('haTest', String(Date.now())),
          }),
        ]),
        row([Text({}, [s.getItem('haTestResult') || ''])]),
      ]),

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
