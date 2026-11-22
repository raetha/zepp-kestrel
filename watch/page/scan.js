// One Bluetooth scan: the steady devices heard, strongest first. Shared by
// room detection, room calibration and the BLE probe.

import { mstStartScan, mstStopScan } from '@zos/ble'
import { ScanAggregator } from '../lib/ble.js'

let busy = false

/**
 * @param ms how long to listen
 * @param onProgress optional (devicesHeardSoFar) => void, about once a second
 * @returns Promise<[{ mac, name, rssi, hits }]> (rotating addresses dropped),
 *          or null if a scan was already running or couldn't start
 */
export function scanOnce(ms, onProgress = null) {
  if (busy) return Promise.resolve(null)
  const agg = new ScanAggregator()
  let ok
  try {
    ok = mstStartScan((res) => agg.add(res))
  } catch (e) {
    ok = false
  }
  if (ok === false) return Promise.resolve(null)
  busy = true
  return new Promise((resolve) => {
    let left = ms
    const tick = setInterval(() => {
      left -= 1000
      if (onProgress) onProgress(agg.size)
      if (left > 0) return
      clearInterval(tick)
      try {
        mstStopScan()
      } catch (e) {
        // already stopped
      }
      busy = false
      resolve(agg.summary())
    }, 1000)
  })
}

/** Stop a scan early (when a page closes). */
export function stopScan() {
  if (!busy) return
  try {
    mstStopScan()
  } catch (e) {
    // already stopped
  }
  busy = false
}
