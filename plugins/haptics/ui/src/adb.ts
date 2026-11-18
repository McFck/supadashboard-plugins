// Choosing the adb program and the tablet: the pure parts.
export type Device = { serial: string; state: string };

/** Lines of `adb devices` after the header: `<serial>\t<state>`. */
export function parseDevices(output: string): Device[] {
  const lines = output.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('List of devices'));
  if (header < 0) {
    return [];
  }
  return lines.slice(header + 1).flatMap((line) => {
    const [serial, state] = line.trim().split(/\s+/);
    return serial && state ? [{ serial, state }] : [];
  });
}

/** The configured serial if it is ready, else the only ready device. Unauthorized and offline ones never count. */
export function pickDevice(devices: Device[], wanted?: string): string | undefined {
  const ready = devices.filter((device) => device.state === 'device');
  if (wanted) {
    return ready.find((device) => device.serial === wanted)?.serial;
  }
  return ready.length === 1 ? ready[0].serial : undefined;
}

export const validSerial = (serial: string) => /^[A-Za-z0-9._:-]{1,64}$/.test(serial);

export function powerOffArgs(lockWithPc: boolean, serial?: string): string[] | null {
  return lockWithPc && serial ? ['-s', serial, 'shell', 'input', 'keyevent', '223'] : null;
}

/**
 * Programs to try in order: the override, else an installed SDK's platform-tools, else adb on PATH. The host
 * expands `%VAR%` (an unset one fails to start), so the first that runs `adb devices` wins.
 */
export const adbCandidates = (override?: string) =>
  override
    ? [override]
    : [
        '%ANDROID_HOME%\\platform-tools\\adb.exe',
        '%ANDROID_SDK_ROOT%\\platform-tools\\adb.exe',
        '%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\adb.exe',
        'adb.exe',
      ];
