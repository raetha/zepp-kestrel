// Pair with Home Assistant: the phone looks for HA on the local network, HA shows
// a 6-digit code as a notification, and the code is typed in here.

import { BasePage } from '@zeppos/zml/base-page'
import { replace } from '@zos/router'
import { getDeviceInfo } from '@zos/device'
import { text, setText, button, clear, fit, ask, COLOR } from './ui.js'
import { METHOD } from '../lib/protocol.js'
import { saveTargets } from './store.js'
import * as haptics from './haptics.js'

const BALANCE_3 = [11141376, 11141377, 11141379]

function watchName() {
  try {
    const { deviceSource } = getDeviceInfo()
    if (BALANCE_3.includes(deviceSource)) return 'Amazfit Balance 3'
  } catch (e) {
    // fall through
  }
  return 'Amazfit watch'
}

Page(
  BasePage({
    onInit() {
      this.widgets = []
      this.code = ''
    },

    build() {
      this.titleW = text({ y: 34, h: 40, size: 28, value: 'Pair' })
      this.msgW = text({ x: 60, y: 80, w: 360, h: 120, size: 21, value: '' })
      this.discover()
    },

    add(w) {
      this.widgets.push(w)
      return w
    },

    // ------------------------------------------------------------ step 1: find HA
    discover() {
      clear(this.widgets)
      setText(this.titleW, 'Pair')
      setText(this.msgW, 'Looking for Home Assistant on your network…')
      ask(this, METHOD.DISCOVER, undefined, 15000)
        .then((r) => {
          const found = (r && r.found) || []
          if (r && r.error) return this.nothing(r.error)
          if (!found.length) return this.nothing()
          clear(this.widgets)
          setText(this.msgW, found.length === 1 ? 'Found:' : 'Choose your Home Assistant:')
          found.slice(0, 3).forEach((ha, i) =>
            this.add(button({ x: 90, w: 300, y: 150 + i * 70, h: 58, label: fit(ha.haName, 20), primary: true, onClick: () => this.start(ha) })),
          )
          this.add(button({ x: 150, w: 180, y: 380, h: 50, size: 22, label: 'Search again', onClick: () => this.discover() }))
        })
        .catch(() => this.nothing('Phone not reachable. Is the Zepp app open and connected?'))
    },

    nothing(error) {
      clear(this.widgets)
      setText(
        this.msgW,
        error ||
          'No Home Assistant with WristWand found. Your phone must be on the home Wi-Fi, and the WristWand integration added in HA.',
      )
      this.add(button({ x: 120, w: 240, y: 320, h: 56, label: 'Try again', primary: true, onClick: () => this.discover() }))
    },

    // ------------------------------------------------------------ step 2: code
    start(ha) {
      clear(this.widgets)
      setText(this.msgW, `Asking ${ha.haName} for a code…`)
      ask(this, METHOD.PAIR_START, { url: ha.url, watchName: watchName() }, 15000)
        .then((r) => {
          if (!r || r.error || !r.pairingId) return this.nothing((r && r.error) || 'Home Assistant did not answer')
          this.ha = ha
          this.pairingId = r.pairingId
          this.keypad()
        })
        .catch(() => this.nothing('Phone not reachable'))
    },

    keypad() {
      clear(this.widgets)
      this.code = ''
      setText(this.titleW, 'Enter the code')
      setText(this.msgW, '')
      this.add(text({ y: 74, h: 30, size: 18, color: COLOR.quiet, value: 'shown in Home Assistant' }))
      this.codeW = this.add(text({ y: 98, h: 40, size: 34, value: this.codeText() }))
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Del', '0', 'OK']
      keys.forEach((k, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        this.add(
          button({
            x: 86 + col * 106,
            y: 146 + row * 70,
            w: 96,
            h: 60,
            size: 28,
            label: k,
            primary: k === 'OK',
            onClick: () => this.key(k),
          }),
        )
      })
    },

    codeText() {
      return (this.code + '______').slice(0, 6).split('').join(' ')
    },

    key(k) {
      if (k === 'Del') this.code = this.code.slice(0, -1)
      else if (k === 'OK') return this.confirm()
      else if (this.code.length < 6) this.code += k
      setText(this.codeW, this.codeText())
    },

    confirm() {
      if (this.code.length !== 6) return
      setText(this.codeW, 'Checking…')
      ask(this, METHOD.PAIR_CONFIRM, { url: this.ha.url, pairingId: this.pairingId, code: this.code }, 15000)
        .then((r) => {
          if (r && r.ok) return this.paired(r.haName)
          haptics.failed()
          const err = (r && r.error) || 'Failed'
          if (/expired|start again/i.test(err)) return this.nothing(`${err}.`)
          this.code = ''
          setText(this.codeW, 'Wrong code')
          setTimeout(() => this.codeW && setText(this.codeW, this.codeText()), 1200)
        })
        .catch(() => setText(this.codeW, 'Phone not reachable'))
    },

    // ------------------------------------------------------------ step 3: done
    paired(haName) {
      haptics.done()
      clear(this.widgets)
      setText(this.titleW, 'Paired')
      setText(this.msgW, `Connected to ${haName}. Getting your devices…`)
      ask(this, METHOD.SYNC, undefined, 15000)
        .then((r) => {
          if (r && r.targets) saveTargets(r.targets)
          setText(this.msgW, `Connected to ${haName}. ${r && r.targets ? r.targets.length : 0} devices ready to paint.`)
        })
        .catch(() => setText(this.msgW, `Connected to ${haName}. Sync devices from the home screen.`))
        .finally(() =>
          this.add(button({ x: 120, w: 240, y: 320, h: 56, label: 'Done', primary: true, onClick: () => replace({ url: 'page/home' }) })),
        )
    },
  }),
)
