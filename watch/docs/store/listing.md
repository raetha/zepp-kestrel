# Kestrel: Zepp store listing

What to enter in the Zepp Console for the watch app. How to submit: `docs/store.md`.

**Name:** Kestrel (all languages)
**Category:** Tools (or Smart home, if the Console offers it)
**Package:** `kestrel-<version>.zab` from the GitHub release (app ID 1132466)
**Supported devices:** the Console detects them from the package; untick the Zepp OS 3.x watches (see `docs/store.md`)
**Icon:** `icon.png` (240×240)
**Screenshots:** `screenshot-home.png`, `screenshot-point.png`, `screenshot-paint.png`, `screenshot-more.png` (360×360, transparent outside the round screen)

The watch app's own text is English in every language: the descriptions below say so.

## Short description

- **English:** Point your watch at a light, TV or lock and trigger it with a flick, snap or tap. Needs Home Assistant with the free Kestrel integration.
- **简体中文：** 用手表指向灯、电视或门锁，轻甩手腕、打响指或轻点即可控制。需要 Home Assistant 和免费的 Kestrel 集成。
- **繁體中文：** 用手錶指向燈、電視或門鎖，輕甩手腕、彈指或輕點即可控制。需要 Home Assistant 和免費的 Kestrel 整合。

## Full description

**English**

Kestrel turns your watch into a pointer for your smart home. Paint each device once by sweeping your arm across it, then just point at it: the screen turns green when Kestrel has locked on, and a wrist flick, finger snap, tap or button press toggles it.

- Works with lights, switches, fans, media players, locks, covers, climate, scenes, scripts and buttons in Home Assistant.
- Roll your wrist to dim a light or change a speaker's volume.
- Knows which room you're in from nearby Bluetooth devices (or a Home Assistant room sensor), so it never picks a light in the next room.
- Locks always ask for a confirming tap. "Not it?" fixes a wrong pick in one tap and teaches Kestrel where you aimed.
- Gets better with use, and keeps your setup in Home Assistant, so a new watch picks up where the old one left off.
- Private by design: it talks only to your own Home Assistant on your home network. No accounts, no cloud, no tracking.

Requires Home Assistant with the free, open-source Kestrel integration (installed through HACS: github.com/raetha/zepp-kestrel), and a watch with a compass on Zepp OS 4. The watch app is in English.

**简体中文**

Kestrel 让手表成为智能家居的指向器。只需挥动手臂扫过每个设备一次进行"标记"，之后指向它即可：Kestrel 锁定后屏幕变绿，轻甩手腕、打响指、轻点屏幕或按键即可切换。

- 支持 Home Assistant 中的灯、开关、风扇、媒体播放器、门锁、窗帘、空调、场景、脚本和按钮。
- 转动手腕即可调节灯光亮度或音箱音量。
- 通过附近的蓝牙设备（或 Home Assistant 房间传感器）判断你所在的房间，不会误选隔壁房间的灯。
- 门锁总是需要点按确认。"不是它？"一键纠正误选，并让 Kestrel 记住你的指向。
- 越用越准，设置保存在 Home Assistant 中，换新手表也能继续使用。
- 注重隐私：只与你家庭网络中的 Home Assistant 通信。无需账号，不经云端，不做追踪。

需要安装免费开源的 Kestrel 集成的 Home Assistant（通过 HACS 安装：github.com/raetha/zepp-kestrel），以及带指南针、运行 Zepp OS 4 的手表。手表应用界面为英文。

**繁體中文**

Kestrel 讓手錶成為智慧家居的指向器。只需揮動手臂掃過每個裝置一次進行「標記」，之後指向它即可：Kestrel 鎖定後螢幕變綠，輕甩手腕、彈指、輕點螢幕或按鍵即可切換。

- 支援 Home Assistant 中的燈、開關、風扇、媒體播放器、門鎖、窗簾、空調、場景、腳本和按鈕。
- 轉動手腕即可調整燈光亮度或喇叭音量。
- 透過附近的藍牙裝置（或 Home Assistant 房間感測器）判斷你所在的房間，不會誤選隔壁房間的燈。
- 門鎖一律需要點按確認。「不是它？」一鍵修正誤選，並讓 Kestrel 記住你的指向。
- 越用越準，設定儲存在 Home Assistant 中，換新手錶也能繼續使用。
- 重視隱私：只與你家用網路中的 Home Assistant 通訊。無需帳號，不經雲端，不做追蹤。

需要安裝免費開源的 Kestrel 整合的 Home Assistant（透過 HACS 安裝：github.com/raetha/zepp-kestrel），以及配備指南針、執行 Zepp OS 4 的手錶。手錶應用介面為英文。

## Calling permissions

Tick what the package asks for (`watch/app.json` → `permissions`), with these reasons if the Console asks:

- **Accelerometer, gyroscope, compass:** to work out where your arm points and recognise gestures.
- **Bluetooth:** to scan for nearby devices that tell rooms apart.
- **Device information:** the watch model, and its unique id so Home Assistant recognises the same watch when paired again (kept only as a hash).
- **Step data:** only with Detailed diagnostics on in Home Assistant: steps taken while pointing, to tune room detection. Optional.

**SDK inclusion:** none besides Zepp's own ZML (`@zeppos/zml`) and simple-statistics (MIT), bundled in the app.

## Privacy statement

Paste `PRIVACY.md` (repository root), or link it: https://github.com/raetha/zepp-kestrel/blob/main/PRIVACY.md

## Work statement

Kestrel is an original app by raetha, open source under the MIT licence: https://github.com/raetha/zepp-kestrel. All code and artwork (the kestrel logo and icon) were made for this project; the bundled libraries are Zepp's ZML and simple-statistics (MIT). It is not affiliated with Home Assistant or the Open Home Foundation.
