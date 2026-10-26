#!/usr/bin/env node
// Replay a Kestrel diagnostics download against the current watch code.
//
//   node tools/replay.mjs <diagnostics.json>
//
// Uses watch/lib as it is now, so a change to the classifier or room matching
// can be checked against what a real watch recorded:
//   - rooms: each calibration scan matched against all rooms, and rooms that
//     sound alike to Bluetooth;
//   - paints: each spot (painted, learned or a correction), and the device crowding it (if any);
//   - aim traces: each trigger's last seconds re-run through the Aimer with
//     today's paints, against what was fired (and what it was corrected to);
//   - battery: drain while each Point session was open, when the trail has it.

import fs from 'node:fs'
import { rankRooms, pickRoom, soundsLike, spotsForRoom } from '../watch/lib/rooms.js'
import { Aimer, STATE } from '../watch/lib/classifier.js'
import { crowdedBy } from '../watch/lib/paint.js'

const file = process.argv[2]
if (!file) {
  console.error('usage: node tools/replay.mjs <diagnostics.json>')
  process.exit(2)
}
const diag = JSON.parse(fs.readFileSync(file, 'utf8'))
const data = diag.data || diag
const watch = data.watch || (data.watches || [])[0] || {}
const probes = data.probes || []
const rooms = watch.rooms || {}
const paints = watch.paints || {}
const short = (id) => (id ? String(id).replace(/^[a-z_]+\./, '') : '-')

console.log(`Watch ${watch.name || '?'} (${(watch.status && watch.status.app_version) || '?'})`)

// ------------------------------------------------------------------ rooms
console.log('\nRooms')
for (const id of Object.keys(rooms)) {
  const alike = soundsLike(rooms, id)
  console.log(`  ${rooms[id].name}: ${Object.keys(rooms[id].fingerprint || {}).length} devices${alike ? `, sounds like ${alike.name} (${alike.score})` : ''}`)
}
for (const p of probes.filter((x) => x.test === 'room')) {
  for (const scan of p.scans || []) {
    const ranked = rankRooms(rooms, scan)
    const picked = pickRoom(ranked)
    const ok = picked && picked.id === p.area ? 'ok ' : picked ? 'WRONG' : 'unsure'
    console.log(`  scan in ${p.name}: ${ok.padEnd(6)} ${ranked.map((r) => `${r.name} ${r.score.toFixed(2)}`).join(', ')}`)
  }
}

// ------------------------------------------------------------------ paints
console.log('\nPaints')
for (const id of Object.keys(paints)) {
  for (const s of paints[id]) {
    const c = s.kind === 'correction' ? null : crowdedBy(paints, id, s)
    const what = s.kind === 'correction' ? 'correction' : `±${s.headingSpread}°${s.kind === 'learned' ? ` learned×${s.uses || 1}` : ''}`
    console.log(`  ${short(id).padEnd(28)} ${String(s.heading).padStart(6)}° ${what.padEnd(10)} pitch ${s.pitch}° ${s.room || ''}${c ? `  crowded by ${short(c.id)} (${c.headingGap}° apart)` : ''}`)
  }
}

// ------------------------------------------------------------------ aim traces
console.log('\nTriggers (fired → corrected to; what today\'s code would show at the trigger)')
// as Point does: sure of the room, other rooms' spots are left out; only just, they count half
const devicesIn = (room, sure) =>
  Object.keys(paints)
    .map((id) => ({ id, spots: spotsForRoom(paints[id], room, sure ? 0 : undefined) }))
    .filter((d) => d.spots.length)
let agree = 0
let total = 0
for (const p of probes.filter((x) => x.test === 'point' && Array.isArray(x.trace))) {
  const cols = (p.columns || 'ms,heading,pitch,roll,ready,state,best').split(',')
  const at = (row, k) => row[cols.indexOf(k)]
  const aimer = new Aimer()
  const devices = devicesIn(p.room, p.roomSure)
  let last = null
  for (const row of p.trace) {
    if (at(row, 'ms') > 0) break
    const h = at(row, 'heading')
    if (h === null || h === undefined) continue
    last = aimer.update(at(row, 'ms'), !!at(row, 'ready'), devices, h, at(row, 'pitch'))
  }
  const wanted = p.target // a correction logs the right device as target
  const now = last && last.best ? last.best.id : null
  total++
  if (now === wanted) agree++
  const then = p.correctedFrom ? `${short(p.correctedFrom)} → ${short(p.target)}` : short(p.target)
  const state = last ? last.state : STATE.RESTING
  const ratio = last && last.best && last.runnerUp ? ` lead ${Math.min(99, last.best.weight / last.runnerUp.weight).toFixed(1)}x` : ''
  console.log(`  ${new Date(p.at).toISOString().slice(5, 16)} ${p.via.padEnd(6)} ${then.padEnd(40)} now: ${state} ${short(now)}${ratio} (room ${p.room || '-'}${p.roomSure === false ? '?' : ''})`)
}
if (total) console.log(`  ${agree} of ${total} would pick the same device today`)

// ------------------------------------------------------------------ battery
const sessions = []
for (const p of probes.filter((x) => x.test === 'trail')) {
  let open = null
  for (const [t, kind, arg] of p.trail || []) {
    if (kind === 'battery' && arg && arg.page === 'point' && arg.at === 'open') open = { t, level: arg.level }
    if (kind === 'battery' && arg && arg.page === 'point' && arg.at === 'close' && open) {
      sessions.push({ minutes: (t - open.t) / 60000, used: open.level - arg.level })
      open = null
    }
  }
}
if (sessions.length) {
  const minutes = sessions.reduce((a, s) => a + s.minutes, 0)
  const used = sessions.reduce((a, s) => a + s.used, 0)
  console.log(`\nBattery: ${sessions.length} Point sessions, ${minutes.toFixed(1)} min, ${used}% used (${minutes ? ((used / minutes) * 60).toFixed(1) : '?'}% per hour of pointing)`)
}
