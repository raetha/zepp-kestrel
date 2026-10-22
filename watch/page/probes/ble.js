// What does the watch hear over Bluetooth in each room? Enough stable
// devices per room means we can tell rooms apart from the watch alone.

import { mstStartScan, mstStopScan } from '@zos/ble'
import { ScanAggregator } from '../../lib/ble.js'
import { sleep, guard, cycler } from './util.js'

const SCAN_MS = 6000
const ROOMS = ['Room A', 'Room B', 'Room C', 'Room D', 'Room E']

export const bleProbe = {
  title: 'BLE scan',
  start(ctx) {
    const once = guard()
    let scanning = false
    ctx.onCleanup(() => scanning && mstStopScan())

    const room = cycler(ctx, 'Label', ROOMS)
    ctx.status(`Stand somewhere you'd use the app, pick a label, then scan for ${SCAN_MS / 1000} s.\n\nRepeat in each room.`)
    ctx.primary('Scan', () =>
      once(async () => {
        const agg = new ScanAggregator()
        const ok = mstStartScan((res) => agg.add(res))
        if (ok === false) {
          ctx.status('Scan failed to start. Bluetooth may be busy; try again in a few seconds.')
          return
        }
        scanning = true
        for (let s = SCAN_MS / 1000; s > 0; s--) {
          ctx.status(`Scanning ${room()}… ${s} s\n${agg.size} heard so far`)
          await sleep(1000)
        }
        mstStopScan()
        scanning = false

        const stable = agg.summary()
        const top = stable
          .slice(0, 6)
          .map((d) => `${d.rssi} ${d.mac.slice(-5)} ${(d.name || '').slice(0, 12)}`)
          .join('\n')
        ctx.status(`${room()}: ${agg.size} devices, ${stable.length} stable\n${top}`)
        ctx.log({ room: room(), total: agg.size, stable: stable.length, devices: stable })
      }),
    )
  },
}
