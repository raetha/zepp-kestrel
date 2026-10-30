// Thin wrappers over @zos/sensor so probes (and later the real app) share
// one start/stop shape: start(mode, onReading) / stop().

import {
  Accelerometer,
  Gyroscope,
  Compass,
  Battery,
  Step,
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
    // Compass frequency modes arrive in API 4.0; older firmware ignores the mode.
    start(mode, onReading) {
      s = new Compass()
      if (mode && typeof s.setFreqMode === 'function') {
        try {
          s.setFreqMode(MODES[mode])
        } catch (e) {
          // not supported here
        }
      }
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

/** Battery level in percent, or null if it can't be read. */
export function batteryLevel() {
  try {
    const v = new Battery().getCurrent()
    return Number.isFinite(v) ? v : null
  } catch (e) {
    return null
  }
}

/** Today's step count, or null if it can't be read (needs data:user.hd.step). */
export function stepCount() {
  try {
    const v = new Step().getCurrent()
    return Number.isFinite(v) ? v : null
  } catch (e) {
    return null
  }
}
