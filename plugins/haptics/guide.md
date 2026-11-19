Vibrates an Android tablet when you press dashboard controls, turns its screen off with the PC and starts an Artemis stream when the PC wakes. It talks to the tablet over ADB.

Vibration needs Android 12 or newer and a vibration motor.

## 1. Use the tablet as a second screen

- **spacedesk**
  - Install the [Windows Driver and Android Viewer](https://www.spacedesk.net/). Open Viewer on the same network and select the PC.
  - For a cable connection, enable **USB Cable Android** under **Communication Interfaces** in the Windows Driver Console, then plug in the tablet.
  - In Windows display settings, extend the desktop to the new screen.
- **Apollo + Artemis**
  - Install [Apollo](https://github.com/ClassicOldSong/Apollo/releases) on Windows and [Artemis](https://github.com/ClassicOldSong/moonlight-android/releases) on Android, both on the same network.
  - Select the PC in Artemis and enter the pairing PIN in Apollo's web UI.
  - Start **Virtual Display** from Artemis, then set Windows to extend to that display.

Move the dashboard onto the tablet screen.

## 2. Connect ADB

1. Unzip [Android SDK Platform-Tools for Windows](https://developer.android.com/tools/releases/platform-tools). If ADB is outside your Android SDK or PATH, enter the full path to `adb.exe` in **ADB path**.
2. On the tablet, tap **Build number** seven times in **About tablet** or **Software information**. Open **Developer options** and turn on **USB debugging**.
3. Connect with a USB data cable. Unlock the tablet and accept **Allow USB debugging**.
4. Turn on **Tablet** in the plugin. If several devices are listed, enter the tablet's serial in **Device serial**.

## 3. Use it

- **Lock with PC** sends the Android sleep key when Windows suspends or ends the session. Set a tablet screen lock and choose when it locks after the screen turns off.
- **Artemis host** is the paired PC's name as shown in Artemis. A blank host opens the Artemis PC list.
- **Artemis app** defaults to Apollo's built-in **Virtual Display**. For a custom entry such as **Desktop**, use its exact name and enable **Always create Virtual Display** for it in Apollo.
- **Launch Artemis on wake or connect** starts that stream when the PC resumes or ADB connects.
- **USB tethering** gives Apollo and Artemis a network over the cable if the tablet supports it.

## If it does not connect

- Run `adb devices` from the platform-tools folder. The tablet should show as `device`. If it says `unauthorized`, accept the prompt on the tablet.
- If Artemis does not find the stream, open the host's app list in Artemis once so it can look up the stream by name.
- Unlock the tablet if Android shows its lock screen.
- If the USB tethering switch fails, turn on USB tethering in Android settings or use Wi-Fi.
