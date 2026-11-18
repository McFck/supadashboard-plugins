import { pluginProcess } from '@supadashboard/kit';
import { afterEach, expect, it, vi } from 'vitest';
import { artemisLaunchArgs, enableUsbTethering, hasUsbTethering } from './artemis';

vi.mock('@supadashboard/kit', () => ({ pluginProcess: { run: vi.fn() } }));

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

it.each([
  ['rndis\r\n', true],
  ['adb, rndis\n', true],
  ['adb\r\nncm,adb\r\n', true],
  ['\n\nmtp,ncm\n', true],
  ['\nmtp,adb\nnone\n', false],
  ['Error: rndis is unsupported\nnot_ncm,adb\n', false],
])('recognizes USB function lists in %j', (output, expected) => {
  expect(hasUsbTethering(output)).toBe(expected);
});

it('leaves a tethered USB connection alone', async () => {
  const run = vi.mocked(pluginProcess.run);
  run.mockResolvedValue({ code: 0, stdout: 'ncm,adb\n' });

  await expect(enableUsbTethering({ adb: 'adb.exe', serial: 'TABLET' })).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledTimes(1);
});

it('verifies tethering after a USB reset interrupts ADB', async () => {
  vi.useFakeTimers();
  const run = vi.mocked(pluginProcess.run);
  run
    .mockResolvedValueOnce({ code: 0, stdout: 'adb\n' })
    .mockRejectedValueOnce(new Error('ADB disconnected'))
    .mockResolvedValueOnce({ code: 0, stdout: 'rndis,adb\n' });

  const result = enableUsbTethering({ adb: 'adb.exe', serial: 'TABLET' });
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBeUndefined();
  expect(run.mock.calls[1]?.[2]).toEqual([
    '-s',
    'TABLET',
    'shell',
    'svc',
    'usb',
    'setFunctions',
    'rndis',
  ]);
  expect(run.mock.calls[2]?.[2].slice(0, 4)).toEqual(['-s', 'TABLET', 'wait-for-device', 'shell']);
});

it('targets the Artemis shortcut with shell-quoted host and app names', () => {
  expect(artemisLaunchArgs("Owner's PC", 'Virtual Display; ${HOME}')).toEqual([
    'am',
    'start',
    '-W',
    '-n',
    'com.limelight.noir/com.limelight.ShortcutTrampoline',
    '--es',
    'Name',
    "'Owner'\\''s PC'",
    '--es',
    'AppName',
    "'Virtual Display; ${HOME}'",
  ]);
});

it('opens the Artemis PC list for settings saved without a host', () => {
  expect(artemisLaunchArgs('', 'Virtual Display')).toContain(
    'com.limelight.noir/com.limelight.PcView',
  );
});
