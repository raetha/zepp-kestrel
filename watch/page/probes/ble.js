// What does the watch hear over Bluetooth in each room? Enough stable
// devices per room means we can tell rooms apart from the watch alone.

import { scanOnce, stopScan } from '../scan.js'
import { areas } from '../store.js'
import { guard, cycler } from './util.js'

const SCAN_MS = 6000

export const bleProbe = {
  title: 'BLE scan',
  start(ctx) {
    const once = guard(ctx)
    ctx.onCleanup(() => stopScan())

    // the Home Assistant areas (from the last Sync); generic labels before the first
    const names = areas().map((a) => a.name)
    const room = cycler(ctx, 'Room', names.length ? names : ['Room A', 'Room B', 'Room C', 'Room D', 'Room E'])
    ctx.status(`Stand somewhere you'd use the app, pick a label, then scan for ${SCAN_MS / 1000} s.\n\nRepeat in each room.`)
    ctx.primary('Scan', () =>
      once(async () => {
        const stable = await scanOnce(SCAN_MS, (n) => ctx.status(`Scanning ${room()}…\n${n} heard so far`))
        if (!ctx.alive()) return
        if (!stable) {
          ctx.status('Scan failed to start. Bluetooth may be busy; try again in a few seconds.')
          return
        }
        const top = stable
          .slice(0, 6)
          .map((d) => `${d.rssi} ${d.mac.slice(-5)} ${(d.name || '').slice(0, 12)}`)
          .join('\n')
        ctx.status(`${room()}: ${stable.length} steady devices\n${top}`)
        ctx.log({ room: room(), stable: stable.length, devices: stable })
      }),
    )
  },
}
