import { describe, expect, it } from 'vitest';
import { DEFAULTS, normalizeSettings } from './settings';

describe('haptics settings', () => {
  it('reads damaged saved data as the defaults', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULTS);
    expect(
      normalizeSettings({
        enabled: 'yes',
        pressPulse: 1,
        adbPath: 5,
        serial: {},
        strength: 'loud',
        lockWithPc: 'yes',
      }),
    ).toEqual(DEFAULTS);
  });
});
