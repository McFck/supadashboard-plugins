Makes a USB-connected Android tablet a better dashboard screen: it vibrates when you press a button and can lock the tablet when the PC sleeps or shuts down. It drives the tablet over **adb**, Android's debugging tool, so nothing is installed on the tablet.

Setup takes about ten minutes, once. You need a USB cable that carries data, not only charging.

## 1. Install adb on the PC

1. Download [SDK Platform-Tools for Windows](https://developer.android.com/tools/releases/platform-tools) and unzip it, for example to `C:\platform-tools`.
2. SupaDashboard finds adb in an installed Android SDK or on PATH. Otherwise paste the full path to `adb.exe` into **ADB path** on this page, for example `C:\platform-tools\adb.exe`.

## 2. Turn on USB debugging on the tablet

1. Open **Settings**, then **About tablet**, and tap **Build number** seven times until the tablet says you are a developer. On some tablets it is under **Software information**.
2. Open **Settings**, then **System**, then **Developer options**, and turn on **USB debugging**.
3. Connect the tablet to the PC. When the tablet asks to allow USB debugging, tick **Always allow from this computer** and tap **Allow**.

## 3. Check that the PC sees the tablet

1. Open the platform-tools folder, type `cmd` in the File Explorer address bar and press Enter.
2. Run `adb devices`. The tablet should be listed with the word `device`.
3. `unauthorized` means the prompt on the tablet was not accepted: unplug the cable, plug it back in and allow it. An empty list usually means the cable only charges; try another one.

## 4. Turn it on

1. Turn on **Tablet** on this page. The tablet is found by itself.
2. With more than one Android device connected, copy the tablet's serial from `adb devices` into **Device serial**.
3. Pick a **Vibration strength** and choose whether every press vibrates with **Vibrate on press**.
4. Turn on **Lock with PC** to switch the tablet's screen off when the PC sleeps, shuts down, restarts or signs out.

## Use it

- Add the **Vibrate** action to a button or scenario for a **Tick**, **Tap** or **Confirm** pulse.
- Vibration needs Android 12 or newer and a tablet with a vibration motor. Locking works without one.
