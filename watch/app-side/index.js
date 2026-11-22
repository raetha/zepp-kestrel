// Side service: runs inside the Zepp app on the phone. Its behaviour is in
// lib/side.js (tested in Node); this only hands it to ZML.

import { BaseSideService } from '@zeppos/zml/base-side'
import { sideService } from '../lib/side.js'

AppSideService(BaseSideService(sideService()))
