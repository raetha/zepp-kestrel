// Tiny UI helpers. Layout is designed for a 480 x 480 round screen; px()
// scales it to the watch's width, and on taller screens (square watches,
// 390 x 450) it is centred vertically, with full-screen backgrounds filling
// the whole screen.
//
// Text is sized to be read at arm's length (about 45 cm): nothing smaller than
// SIZE.small, and secondary text is light grey rather than dim, so it stays
// legible in the watch's red night mode.

import { createWidget, deleteWidget, widget, align, prop, text_style } from '@zos/ui'
import { px } from '@zos/utils'
import { getDeviceInfo } from '@zos/device'
import { onKey, offKey, onGesture, offGesture, KEY_SELECT, KEY_BACK, KEY_EVENT_CLICK, KEY_EVENT_PRESS, KEY_EVENT_RELEASE } from '@zos/interaction'
import { back } from '@zos/router'
import { note, noteOnce, noteBuilds, appVersion, safe } from './trail.js'
import { BUILD } from '../lib/version.js'
import { METHOD, RELAYED } from '../lib/protocol.js'
import { HaApi } from '../lib/ha-api.js'

let SCREEN = { w: 480, h: 480 }
try {
  const d = getDeviceInfo()
  if (d && d.width && d.height) SCREEN = { w: d.width, h: d.height }
} catch (e) {
  // keep the design size
}
const Y0 = Math.max(0, Math.round((SCREEN.h - SCREEN.w) / 2))
/** A y position in the 480 design, on this screen. */
const py = (y) => px(y) + Y0

export const COLOR = {
  bg: 0x000000,
  text: 0xffffff,
  quiet: 0xc8c8c8, // secondary text; darker greys fade out in night mode
  accent: 0xd9622b, // the logo's rufous orange
  accentPressed: 0xa84718,
  button: 0x2a2a2a,
  buttonPressed: 0x444444,
  good: 0x3ddc84,
  bad: 0xff5a5a,
  aiming: 0xf0a030,
  candidate: 0x3ddc84,
}

/** Text sizes, at 480 wide. */
export const SIZE = {
  title: 34,
  body: 25,
  button: 27,
  small: 23, // the smallest text anywhere: hints, captions, the version
}

export function text({ x = 60, y, w = 360, h = 40, size = SIZE.body, color = COLOR.text, value = '', center = true }) {
  return createWidget(widget.TEXT, {
    x: px(x),
    y: py(y),
    w: px(w),
    h: px(h),
    text: value,
    text_size: px(size),
    color,
    align_h: center ? align.CENTER_H : align.LEFT,
    align_v: align.TOP,
    text_style: text_style.WRAP,
  })
}

export function setText(w, value) {
  w.setProperty(prop.TEXT, value)
}

export function button({ x = 110, y, w = 260, h = 60, label, onClick, primary = false, size = SIZE.button }) {
  return createWidget(widget.BUTTON, {
    x: px(x),
    y: py(y),
    w: px(w),
    h: px(h),
    radius: px(h / 2),
    normal_color: primary ? COLOR.accent : COLOR.button,
    press_color: primary ? COLOR.accentPressed : COLOR.buttonPressed,
    text: label,
    text_size: px(size),
    color: COLOR.text,
    click_func: onClick,
  })
}

export function setLabel(btn, label) {
  btn.setProperty(prop.TEXT, label)
}

/** Delete widgets created for one step of a page. */
export function clear(list) {
  for (const w of list.splice(0)) {
    try {
      deleteWidget(w)
    } catch (e) {
      // already gone
    }
  }
}

export function circle({ x = 240, y = 240, r = 120, color = COLOR.button }) {
  return createWidget(widget.CIRCLE, { center_x: px(x), center_y: py(y), radius: px(r), color })
}

export function setColor(w, color) {
  w.setProperty(prop.MORE, { color })
}

/**
 * A ring of dots round the screen's edge (compass calibration progress,
 * lib/circling.js): tick 0 at 12 o'clock, going clockwise.
 */
export function tickRing({ n = 12, r = 218, dot = 10, color = 0x333333 } = {}) {
  const dots = []
  const at = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    at.push({ x: Math.round(240 + r * Math.sin(a)), y: Math.round(240 - r * Math.cos(a)) })
    dots.push(circle({ ...at[i], r: dot, color }))
  }
  // a circle's colour only changes when its geometry is given again with it
  const paint = (i, c) => dots[i].setProperty(prop.MORE, { center_x: px(at[i].x), center_y: py(at[i].y), radius: px(dot), color: c })
  return {
    dots,
    set(i, c) { if (dots[i]) paint(i, c) },
    all(c) { for (let i = 0; i < n; i++) paint(i, c) },
  }
}

/** A filled rectangle (the whole screen by default): a background that can change colour. */
export function rect({ x = 0, y = 0, w = 480, h = 480, color = COLOR.bg } = {}) {
  if (x === 0 && y === 0 && w === 480 && h === 480) return createWidget(widget.FILL_RECT, { x: 0, y: 0, w: SCREEN.w, h: SCREEN.h, color })
  return createWidget(widget.FILL_RECT, { x: px(x), y: py(y), w: px(w), h: px(h), color })
}

/** Change a text widget's colour. */
export function setTextColor(w, color) {
  w.setProperty(prop.COLOR, color)
}

/** Shorten a label to fit a button. */
export function fit(s, n = 18) {
  s = String(s || '')
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/**
 * A request to the phone, with a timeout so a missing phone fails fast.
 * A backup timer of the asking page's own makes sure it always settles
 * (see unstickHandshake for why ZML's might not).
 */
// The phone runs the side service from the Zepp app's own copy of Kestrel. If that
// copy is older or newer than the watch's (seen on an iPhone after a QR install:
// the watch had the new build, the phone still ran one from before the message
// names changed), the phone answers "unknown method". Say what to do instead of
// treating it as "not paired".
export const PHONE_MISMATCH = 'The Zepp app is running a different Kestrel build than the watch. Force-quit the Zepp app and open it again; if that doesn\'t help, reinstall Kestrel.'
export function phoneMismatch(r) {
  return !!(r && r.error && /unknown method/.test(String(r.error)))
}

/**
 * Compare the side service's build (in its status reply) with the watch's. Notes
 * a difference in the trail as an error, once per run, so the trail reaches Home
 * Assistant (diagnostics) with what happened before it, even without detailed
 * diagnostics. -> the phone's build when it differs, else null
 */
export function phoneBuildDiffers(st) {
  if (!st || st.error || st.offline) return null
  const phone = st.build || 'older (no build reported)'
  noteBuilds(appVersion() || BUILD, phone)
  if (phone === BUILD) return null
  noteOnce('phone-build', 'error', { where: 'phone', error: 'different build', watch: BUILD, phone })
  return phone
}

/**
 * Ask the phone. Requests for Home Assistant (RELAYED in lib/protocol.js) are built
 * here (lib/ha-api.js) and the phone side only relays them, so new features need no
 * new phone side; a phone side from before the relay gets them by name instead.
 * Resolves with the reply ({ ok: false, error } when Home Assistant or the phone
 * refused); rejects only when the phone didn't answer.
 */
export function ask(page, method, params, timeout = 6000) {
  const fn = RELAYED[method]
  const g = appData()
  if (!fn || (g && g.noRelay)) return askPhone(page, method, params, timeout)
  const api = new HaApi(async (path, opts = {}) => {
    const r = await askPhone(page, METHOD.RELAY, { path, method: opts.method || 'GET', body: opts.body }, timeout)
    if (r && r.relayed) return r.body
    throw Object.assign(new Error((r && r.error) || 'No reply'), { replied: true, noRelay: phoneMismatch(r) })
  })
  return api[fn](params || {}).catch((e) => {
    if (e && e.noRelay) {
      // an older phone side: it still knows the request by name
      if (g) g.noRelay = true
      return askPhone(page, method, params, timeout)
    }
    if (e && e.replied) return { ok: false, error: e.message }
    throw e // the phone didn't answer
  })
}

function appData() {
  try {
    const app = getApp()
    return (app && app._options && app._options.globalData) || null
  } catch (e) {
    return null
  }
}

/** One request to the phone side, with a backup timeout (see unstickHandshake). */
export function askPhone(page, method, params, timeout = 6000) {
  unstickHandshake(page)
  const req = page.request({ method, params }, { timeout })
  return new Promise((resolve, reject) => {
    let settled = false
    const backup = setTimeout(() => {
      if (settled) return
      settled = true
      unstickHandshake(page)
      reject(new Error('Phone not reachable'))
    }, timeout + 1000)
    const finish = (fn) => (v) => {
      if (settled) return
      settled = true
      clearTimeout(backup)
      fn(v)
    }
    req.then(
      finish((r) => {
        // the phone runs a different build's side service: note it once per run (see phoneMismatch)
        if (phoneMismatch(r)) noteBuilds(appVersion() || BUILD, 'unknown method')
        if (phoneMismatch(r)) noteOnce('phone-mismatch', 'error', { where: 'phone', error: String(r.error).slice(0, 80), method, watch: BUILD })
        resolve(r)
      }),
      finish(reject),
    )
  })
}

// ZML greets the phone (a "shake") before requests, and gives up after 5 s
// with a timer. Zepp OS cancels a page's timers when the page closes, so
// leaving a page while the phone hadn't answered yet left the handshake
// pending forever, and every later request, on any page, waited behind it
// (seen on the emulator: Home stuck on "Checking…"). A handshake still
// pending well past its own limit lost its timer: mark it failed so the next
// request starts a fresh one.
const SHAKE_STUCK_MS = 5500 // ZML's handshake gives up after 5 s
function unstickHandshake(page) {
  const m = page.globalData && page.globalData.messaging
  const tr = m && m.transport
  if (!tr || typeof tr.fork !== 'function') return
  if (!tr.kestrelWatched) {
    const fork = tr.fork.bind(tr)
    tr.fork = (ms) => {
      if (tr.shakeStatus !== 2) tr.kestrelShakeAt = Date.now() // a new handshake starts
      return fork(ms)
    }
    tr.kestrelWatched = true
  }
  if (tr.shakeStatus === 2 && tr.kestrelShakeAt && Date.now() - tr.kestrelShakeAt > SHAKE_STUCK_MS) {
    note('handshake', 'reset')
    tr.shakeStatus = 4
    try {
      if (tr.shakeTask) tr.shakeTask.reject(new Error('handshake abandoned'))
    } catch (e) {
      // nothing waited on it
    }
  }
}

/**
 * Physical buttons for a page: SELECT runs onSelect (when given), BACK goes
 * back a page. opts.onSelectPress / opts.onSelectRelease see the select
 * button go down and up (for hold-to-dim); a click still follows a short
 * press. Every button event and swipe is noted in the trail (page/trail.js).
 * Call the returned function in onDestroy.
 */
export function listenKeys(onSelect, opts = {}) {
  onKey({
    callback: safe('keys', (key, event) => {
      if (event === KEY_EVENT_CLICK) note('key', key) // clicks only: press and release would triple the writes
      if (key === KEY_SELECT && (onSelect || opts.onSelectPress)) {
        if (event === KEY_EVENT_PRESS && opts.onSelectPress) opts.onSelectPress()
        if (event === KEY_EVENT_RELEASE && opts.onSelectRelease) opts.onSelectRelease()
        if (event === KEY_EVENT_CLICK && onSelect) onSelect()
        return true
      }
      if (key === KEY_BACK) {
        if (event === KEY_EVENT_CLICK) back()
        return event === KEY_EVENT_CLICK
      }
      return false
    }),
  })
  onGesture({
    callback: safe('gesture', (event) => {
      note('gesture', event)
      return false
    }),
  })
  return () => {
    offKey()
    offGesture()
  }
}
