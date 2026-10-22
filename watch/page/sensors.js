// Thin wrappers over @zos/sensor so probes (and later the real app) share
// one start/stop shape: start(mode, onReading) / stop().

import {
  Accelerometer,
  Gyroscope,
  Compass,
  FREQ_MODE_LOW,
  FREQ_MODE_NORMAL,
  FREQ_MODE_HIGH,
} from '@zos/sensor'

export const MODES = { LOW: FREQ_MODE_LOW, NORMAL: FREQ_MODE_NORMAL, HIGH: FREQ_MODE_HIGH }

function vectorSensor(Ctor) {
  let s = null
  return {
    start(mode, onReading) {
      s = new Ctor()
      if (mode) s.setFreqMode(MODES[mode])
      s.onChange(() => {
        const r = s.getCurrent()
        onReading({ t: Date.now(), x: r.x, y: r.y, z: r.z })
      })
      s.start()
    },
    stop() {
      if (!s) return
      try {
        s.offChange()
        s.stop()
      } catch (e) {
        // already stopped
      }
      s = null
    },
  }
}

export const accel = () => vectorSensor(Accelerometer)
export const gyro = () => vectorSensor(Gyroscope)

export function compass() {
  let s = null
  return {
    // Compass has no frequency mode; the mode argument is ignored.
    start(_mode, onReading) {
      s = new Compass()
      s.onChange(() => onReading(compassReading(s)))
      s.start()
    },
    read() {
      return s ? compassReading(s) : null
    },
    stop() {
      if (!s) return
      try {
        s.offChange()
        s.stop()
      } catch (e) {
        // already stopped
      }
      s = null
    },
  }
}

function compassReading(s) {
  const calibrated = !!s.getStatus()
  const a = s.getDirectionAngle()
  return { t: Date.now(), calibrated, angle: typeof a === 'number' ? a : null }
}

export const SENSORS = { accel, gyro, compass }
