import { pluginProcess } from '@supadashboard/kit';

export const ARTEMIS_NOT_INSTALLED = 'Artemis not installed';
export const ARTEMIS_LAUNCH_FAILED = 'Could not launch Artemis';
export const USB_TETHERING_FAILED = 'Could not enable USB tethering';

const PACKAGE = 'com.limelight.noir';
const ACTIVITY = `${PACKAGE}/com.limelight.PcView`;

export type Tablet = { adb: string; serial: string };

export async function openArtemis({ adb, serial }: Tablet) {
  try {
    const run = (args: string[]) =>
      pluginProcess.run('haptics', adb, ['-s', serial, 'shell', ...args], 5000);
    const packages = await run(['pm', 'list', 'packages', PACKAGE]);
    if (packages.code !== 0) {
      return ARTEMIS_LAUNCH_FAILED;
    }
    if (!packages.stdout.split(/\r?\n/).some((line) => line.trim() === `package:${PACKAGE}`)) {
      return ARTEMIS_NOT_INSTALLED;
    }
    const launch = await run([
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-n',
      ACTIVITY,
    ]);
    if (launch.code !== 0 || !/^Status: ok\s*$/m.test(launch.stdout)) {
      return ARTEMIS_LAUNCH_FAILED;
    }
  } catch {
    return ARTEMIS_LAUNCH_FAILED;
  }
}

export async function enableUsbTethering({ adb, serial }: Tablet) {
  const run = (args: string[]) => pluginProcess.run('haptics', adb, ['-s', serial, ...args], 5000);
  const tethered = (output: string) => /(?:^|,)\s*(rndis|ncm)\s*(?:,|$)/.test(output.trim());
  try {
    const before = await run(['shell', 'svc', 'usb', 'getFunctions']);
    if (before.code === 0 && tethered(before.stdout)) {
      return;
    }
    await run(['shell', 'svc', 'usb', 'setFunctions', 'rndis']).catch(() => {
      // Switching USB functions can disconnect the ADB transport before the shell exits.
    });
    const after = await run(['wait-for-device', 'shell', 'svc', 'usb', 'getFunctions']);
    if (after.code === 0 && tethered(after.stdout)) {
      return;
    }
  } catch {
    return USB_TETHERING_FAILED;
  }
  return USB_TETHERING_FAILED;
}
