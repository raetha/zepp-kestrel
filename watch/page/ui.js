// Tiny UI helpers for the 480 x 480 round screen. Layout is designed at
// 480 wide; px() scales it for other round Zepp OS watches.
//
// Text is sized to be read at arm's length (about 45 cm): nothing smaller than
// SIZE.small, and secondary text is light grey rather than dim, so it stays
// legible in the watch's red night mode.

import { createWidget, deleteWidget, widget, align, prop, text_style } from '@zos/ui'
import { px } from '@zos/utils'
import { onKey, offKey, onGesture, offGesture, KEY_SELECT, KEY_BACK, KEY_EVENT_CLICK, KEY_EVENT_PRESS, KEY_EVENT_RELEASE } from '@zos/interaction'
import { back } from '@zos/router'
import { note, safe } from './trail.js'

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
    y: px(y),
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
    y: px(y),
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
  return createWidget(widget.CIRCLE, { center_x: px(x), center_y: px(y), radius: px(r), color })
}

export function setColor(w, color) {
  w.setProperty(prop.MORE, { color })
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
export function ask(page, method, params, timeout = 6000) {
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
    req.then(finish(resolve), finish(reject))
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
