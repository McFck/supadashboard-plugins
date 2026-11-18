import { pluginProcess } from '@supadashboard/kit';

export const ARTEMIS_NOT_INSTALLED = 'Artemis not installed';
export const ARTEMIS_LAUNCH_FAILED = 'Could not launch Artemis';
export const USB_TETHERING_FAILED = 'Could not enable USB tethering';

const PACKAGE = 'com.limelight.noir';
export type Tablet = { adb: string; serial: string };

// adb shell joins its arguments into an Android shell command.
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function artemisLaunchArgs(host: string, app: string): string[] {
  const start = ['am', 'start', '-W'];
  if (!host) {
    return [
      ...start,
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-n',
      `${PACKAGE}/com.limelight.PcView`,
    ];
  }
  return [
    ...start,
    '-n',
    `${PACKAGE}/com.limelight.ShortcutTrampoline`,
    '--es',
    'Name',
    shellQuote(host),
    '--es',
    'AppName',
    shellQuote(app),
  ];
}

export async function openArtemis({ adb, serial }: Tablet, host: string, app: string) {
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
    await run(['input', 'keyevent', '224']);
    const launch = await run(artemisLaunchArgs(host, app));
    if (launch.code !== 0 || !/^Status: ok\s*$/m.test(launch.stdout)) {
      return ARTEMIS_LAUNCH_FAILED;
    }
  } catch {
    return ARTEMIS_LAUNCH_FAILED;
  }
}

export function hasUsbTethering(output: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    const functions = line.trim().split(/\s*,\s*/);
    return (
      functions.every((name) => /^[a-z0-9_]+$/.test(name)) &&
      (functions.includes('rndis') || functions.includes('ncm'))
    );
  });
}

export async function enableUsbTethering({ adb, serial }: Tablet) {
  const run = (args: string[]) => pluginProcess.run('haptics', adb, ['-s', serial, ...args], 5000);
  // Some devices expose USB functions through properties. Android's svc writes them to stderr.
  const readFunctions = [
    'shell',
    'getprop sys.usb.state; getprop sys.usb.config; svc usb getFunctions 2>&1',
  ];
  try {
    const before = await run(readFunctions);
    if (before.code !== 0) {
      return USB_TETHERING_FAILED;
    }
    if (hasUsbTethering(before.stdout)) {
      return;
    }
    await run(['shell', 'svc', 'usb', 'setFunctions', 'rndis']).catch(() => {
      // Switching USB functions can disconnect the ADB transport before the shell exits.
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      // setFunctions is asynchronous. Allow the USB reset to begin before waiting on ADB.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      const after = await run(['wait-for-device', ...readFunctions]).catch(() => undefined);
      if (after?.code === 0 && hasUsbTethering(after.stdout)) {
        return;
      }
    }
  } catch {
    return USB_TETHERING_FAILED;
  }
  return USB_TETHERING_FAILED;
}
