// BLE scan helpers: MAC formatting and per-device RSSI aggregation.
// The aggregate is the raw material for room fingerprints.

import { median } from '../../lib/stats.js'

/** Format a 6-byte MAC (ArrayBuffer, typed array or plain array) as AA:BB:... */
export function macToString(addr) {
  const bytes = addr instanceof ArrayBuffer ? new Uint8Array(addr) : addr
  const parts = []
  for (let i = 0; i < bytes.length; i++) {
    parts.push((bytes[i] & 0xff).toString(16).padStart(2, '0').toUpperCase())
  }
  return parts.join(':')
}

/**
 * Phones and many wearables advertise from resolvable private addresses,
 * which rotate every few minutes and are useless for room fingerprints.
 * Those have the top two bits of the first byte set to 01. The scan result
 * does not say whether an address is public or random, so this is a
 * heuristic: flag 01-prefixed addresses, keep everything else.
 */
export function looksRotating(mac) {
  const first = parseInt(mac.slice(0, 2), 16)
  return (first & 0xc0) === 0x40
}

export class ScanAggregator {
  constructor() {
    this.devices = new Map()
  }

  add(result) {
    const mac = macToString(result.dev_addr)
    let d = this.devices.get(mac)
    if (!d) {
      d = { mac, name: result.dev_name || '', rssi: [], rotating: looksRotating(mac) }
      this.devices.set(mac, d)
    }
    if (!d.name && result.dev_name) d.name = result.dev_name
    d.rssi.push(result.rssi)
  }

  /** Devices sorted strongest first, with median RSSI and hit count. */
  summary({ includeRotating = false } = {}) {
    const out = []
    for (const d of this.devices.values()) {
      if (d.rotating && !includeRotating) continue
      out.push({ mac: d.mac, name: d.name, rssi: median(d.rssi), hits: d.rssi.length })
    }
    out.sort((a, b) => b.rssi - a.rssi)
    return out
  }

  get size() {
    return this.devices.size
  }
}
