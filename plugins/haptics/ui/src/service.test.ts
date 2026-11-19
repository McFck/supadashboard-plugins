import { pluginProcess, type PluginProcessEvent } from '@supadashboard/kit';
import { afterEach, expect, it, vi } from 'vitest';
import { HapticsService } from './service';
import { DEFAULTS, toConfig } from './settings';

vi.mock('@supadashboard/kit', () => ({
  isRecord: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  emitPluginEvent: vi.fn().mockResolvedValue(undefined),
  pluginProcess: {
    run: vi.fn(),
    spawn: vi.fn(),
    onPowerOff: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
  },
  toast: { error: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('keeps PC lock available when the vibration shell cannot start', async () => {
  vi.mocked(pluginProcess.run).mockResolvedValue({
    code: 0,
    stdout: 'List of devices attached\nTABLET\tdevice\n',
  });
  vi.mocked(pluginProcess.spawn).mockRejectedValue(new Error('Shell unavailable'));
  vi.mocked(pluginProcess.onPowerOff).mockResolvedValue(undefined);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const service = new HapticsService();
  const config = toConfig({ ...DEFAULTS, enabled: true, lockWithPc: true, adbPath: 'adb.exe' });
  try {
    await expect(service.configure(config)).resolves.toBe(true);
    expect(pluginProcess.onPowerOff).toHaveBeenLastCalledWith('haptics', 'adb.exe', [
      '-s',
      'TABLET',
      'shell',
      'input',
      'keyevent',
      '223',
    ]);
    await service.configure({ ...config, enabled: false });
    expect(pluginProcess.onPowerOff).toHaveBeenLastCalledWith('haptics', 'adb.exe', null);
  } finally {
    service.destroy();
    warning.mockRestore();
  }
});

it('launches on wake with ADB still connected and on a fast replug with the same serial', async () => {
  vi.useFakeTimers();
  const run = vi.mocked(pluginProcess.run);
  run.mockImplementation(async (_plugin, _adb, args) => {
    if (args[0] === 'devices') {
      return { code: 0, stdout: 'List of devices attached\nTABLET\tdevice\n' };
    }
    return { code: 0, stdout: 'package:com.limelight.noir\nStatus: ok\n' };
  });
  let shellEvent: ((event: PluginProcessEvent) => void) | undefined;
  vi.mocked(pluginProcess.spawn).mockImplementation(async (_plugin, _adb, _args, onEvent) => {
    shellEvent = onEvent;
    return 1;
  });
  const service = new HapticsService();
  const launches = () => run.mock.calls.filter(([, , args]) => args.includes('am')).length;
  const replug = () => shellEvent?.({ kind: 'exited', code: 1 });
  try {
    await service.configure(
      toConfig({
        ...DEFAULTS,
        enabled: true,
        artemis: true,
        artemisHost: 'PC',
        adbPath: 'adb.exe',
      }),
    );
    expect(launches()).toBe(1);
    await service.resume();
    expect(launches()).toBe(2);
    replug();
    await vi.advanceTimersByTimeAsync(5000);
    expect(launches()).toBe(2);
    replug();
    await vi.advanceTimersByTimeAsync(5000);
    expect(launches()).toBe(3);
  } finally {
    replug();
    service.destroy();
  }
});

it('rejects unknown strengths and pulse kinds before they reach the tablet shell', async () => {
  vi.mocked(pluginProcess.run).mockResolvedValue({
    code: 0,
    stdout: 'List of devices attached\nTABLET\tdevice\n',
  });
  vi.mocked(pluginProcess.spawn).mockResolvedValue(1);
  vi.mocked(pluginProcess.write).mockResolvedValue(undefined);
  const service = new HapticsService();
  const config = toConfig({ ...DEFAULTS, enabled: true, adbPath: 'adb.exe' });
  try {
    expect(() => service.configure({ ...config, strength: 'huge' })).toThrow('Invalid');
    await service.configure(config);
    service.pulse({ kind: 'nope' });
    service.pulse(null);
    expect(pluginProcess.write).not.toHaveBeenCalled();
  } finally {
    service.destroy();
  }
});
