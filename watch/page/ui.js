// Tiny UI helpers for the 480 x 480 round screen. Layout is designed at
// 480 wide; px() scales it for other round Zepp OS watches.

import { createWidget, widget, align, prop, text_style } from '@zos/ui'
import { px } from '@zos/utils'

export const COLOR = {
  bg: 0x000000,
  text: 0xffffff,
  quiet: 0x9a9a9a,
  accent: 0x7c5cff,
  accentPressed: 0x5a3fd6,
  button: 0x2a2a2a,
  buttonPressed: 0x444444,
  good: 0x3ddc84,
  bad: 0xff5a5a,
}

export function text({ x = 60, y, w = 360, h = 40, size = 24, color = COLOR.text, value = '', center = true }) {
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

export function button({ x = 110, y, w = 260, h = 60, label, onClick, primary = false, size = 26 }) {
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
