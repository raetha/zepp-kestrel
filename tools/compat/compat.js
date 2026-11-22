// Copied into watch-compat/page/ by tools/compat/make_variant.py (never into watch/).
// Reports what this firmware offers Kestrel, as one console line the sweep reads
// from the emulator's serial log: "KCOMPAT caps {...}".

import { Accelerometer, Gyroscope, Compass, Battery } from '@zos/sensor'
import { getDeviceInfo } from '@zos/device'
import * as display from '@zos/display'
import * as ble from '@zos/ble'

const msg = (e) => String((e && e.message) || e)

export function checks(done) {
  const out = { device: null, sensors: {}, api: {} }
  try {
    const d = getDeviceInfo()
    out.device = { source: d.deviceSource, width: d.width, height: d.height, shape: d.screenShape, name: d.deviceName }
  } catch (e) {
    out.device = `error: ${msg(e)}`
  }
  const made = {}
  for (const [name, Ctor] of [['accel', Accelerometer], ['gyro', Gyroscope], ['compass', Compass]]) {
    try {
      const s = new Ctor()
      let n = 0
      s.onChange(() => n++)
      s.start()
      made[name] = { s, n: () => n }
      out.sensors[name] = 'started'
    } catch (e) {
      out.sensors[name] = `error: ${msg(e)}`
    }
  }
  try {
    out.battery = new Battery().getCurrent()
  } catch (e) {
    out.battery = `error: ${msg(e)}`
  }
  for (const k of ['setWakeUpRelaunch', 'setPageBrightTime', 'pauseDropWristScreenOff', 'resetPageBrightTime']) {
    out.api[k] = typeof display[k]
  }
  out.api.bleScan = typeof ble.mstStartScan
  setTimeout(() => {
    for (const k of Object.keys(made)) {
      out.sensors[k] += ` readings=${made[k].n()}`
      if (k === 'compass') {
        try {
          out.sensors[k] += ` status=${made[k].s.getStatus()} angle=${made[k].s.getDirectionAngle()}`
        } catch (e) {
          out.sensors[k] += ` read error: ${msg(e)}`
        }
      }
      try {
        made[k].s.stop()
      } catch (e) {
        // fine
      }
    }
    // the firmware log cuts long lines: one short line per value
    const flat = { ...out.sensors, battery: out.battery, ...out.api }
    if (out.device && typeof out.device === 'object') for (const k of Object.keys(out.device)) flat[`device.${k}`] = out.device[k]
    else flat.device = out.device
    for (const k of Object.keys(flat)) console.log(`KCOMPAT cap ${k}=${flat[k]}`)
    console.log('KCOMPAT caps end')
    done(out)
  }, 3000)
}
