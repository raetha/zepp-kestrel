import { BaseApp } from '@zeppos/zml/base-app'

// No storage here: pages read and write it (page/kv.js). The app context
// kept its own copy of LocalStorage and wrote it back when the app closed,
// which wiped what the pages had written. The home page notes each launch
// (page/trail.js, noteLaunch).
App(
  BaseApp({
    globalData: { launched: false, synced: false },
    onCreate() {},
    onDestroy() {},
  }),
)
