// Which room is the watch in now? From a Home Assistant sensor when the
// settings say so (for example Bermuda), else from a Bluetooth scan matched
// against the rooms calibrated under More -> Rooms (lib/rooms.js).

import { METHOD } from '../lib/protocol.js'
import { rankRooms, pickRoom } from '../lib/rooms.js'
import { rooms, settings } from './store.js'
import { scanOnce } from './scan.js'

export const ROOM_SCAN_MS = 3000

/**
 * @param ask (method, params, timeoutMs) => Promise
 * @returns { room: { id, name, score? } | null, source: 'sensor' | 'scan' | null, ranked }
 */
export async function detectRoom(ask) {
  const s = settings()
  if (s.room.source === 'sensor') {
    const r = await ask(METHOD.ROOM, undefined, 8000).catch(() => null)
    return { room: (r && r.room) || null, source: 'sensor', ranked: [] }
  }
  const known = rooms()
  if (!Object.keys(known).length) return { room: null, source: null, ranked: [] }
  const scan = await scanOnce(ROOM_SCAN_MS)
  if (!scan) return { room: null, source: 'scan', ranked: [] }
  const ranked = rankRooms(known, scan)
  return { room: pickRoom(ranked), source: 'scan', ranked: ranked.slice(0, 3).map((r) => ({ id: r.id, score: Math.round(r.score * 100) / 100 })) }
}
