// M0 probes: measurements of what the watch can do. Each opens page/test with a mode name.

import { BasePage } from '@zeppos/zml/base-page'
import { tracked } from './trail.js'
import { push } from '@zos/router'
import { text, button, listenKeys, COLOR } from './ui.js'

const TESTS = [
  ['rates', 'Sensor rates'],
  ['snap', 'Snap recorder'],
  ['tilt', 'Compass tilt'],
  ['ble', 'BLE scan'],
  ['latency', 'Latency'],
]

Page(
  BasePage(
    tracked('probes', {
      build() {
        this.unkeys = listenKeys()
        text({ y: 40, h: 40, size: 28, value: 'Probes' })
        text({ y: 78, h: 30, size: 18, color: COLOR.quiet, value: 'M0 measurements' })
        TESTS.forEach(([mode, label], i) => {
          button({
            x: 120,
            w: 240,
            y: 120 + i * 68,
            h: 56,
            label,
            onClick: () => push({ url: 'page/test', params: mode }),
          })
        })
      },

      onDestroy() {
        this.unkeys && this.unkeys()
      },
    }),
  ),
)
