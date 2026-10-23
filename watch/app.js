import { BaseApp } from '@zeppos/zml/base-app'

// No storage writes here: the app context keeps its own copy of
// LocalStorage and writes it back when the app closes, which wiped what the
// pages had written (the trail's page entries were lost that way). The home
// page notes each launch instead (page/trail.js, noteLaunch).
App(
  BaseApp({
    globalData: { launched: false, synced: false },
    onCreate() {},
    onDestroy() {},
  }),
)
