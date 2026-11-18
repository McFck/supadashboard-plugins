import { pluginProcess } from '@supadashboard/kit';
import { expect, it, vi } from 'vitest';
import { HapticsService } from './service';
import { DEFAULTS, toConfig } from './settings';

vi.mock('@supadashboard/kit', () => ({
  emitPluginEvent: vi.fn().mockResolvedValue(undefined),
  pluginProcess: { run: vi.fn(), spawn: vi.fn(), onPowerOff: vi.fn() },
}));

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
