import { BaseApp } from '@zeppos/zml/base-app'
import { getDeviceInfo } from '@zos/device'
import { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } from '@zos/interaction'
import { note } from './page/trail.js'

App(
  BaseApp({
    globalData: {},
    onCreate() {
      let device = null
      try {
        const d = getDeviceInfo()
        device = { source: d.deviceSource, width: d.width, height: d.height, shape: d.screenShape }
      } catch (e) {
        device = null
      }
      // A new run starts here; the key codes say which button is which on this watch.
      note('launch', { device, keys: { KEY_BACK, KEY_SELECT, KEY_HOME, KEY_UP, KEY_DOWN, KEY_SHORTCUT } })
    },
    onDestroy() {
      note('exit')
    },
  }),
)
