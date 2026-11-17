import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines } from './lines';
import { firstStationForDirection, normalizeSubwayConfig } from './config';

const files = import.meta.glob('../../../assets/lines/*/{line,pack}.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const bundles = Object.entries(files).reduce<Record<string, { line?: unknown; pack?: unknown }>>(
  (result, [path, value]) => {
    const id = path.includes('/yamanote/')
      ? 'yamanote'
      : path.includes('/hibiya/')
        ? 'hibiya'
        : path.includes('/sakaisuji/')
          ? 'sakaisuji'
          : undefined;
    if (!id) return result;
    result[id] ??= {};
    if (path.endsWith('/line.json')) result[id].line = value;
    if (path.endsWith('/pack.json')) result[id].pack = value;
    return result;
  },
  {},
);
const lines = normalizeSubwayLines(
  Object.values(bundles).map((bundle) => ({ line: bundle.line, pack: bundle.pack })),
);

describe('Subway settings boundary', () => {
  it('persists the selected car and validates it against the line formation', () => {
    expect(normalizeSubwayConfig({ carNumber: '3' }, lines).carNumber).toBe(3);
    expect(normalizeSubwayConfig({ carNumber: '11' }, lines).carNumber).toBe(11);
    for (const carNumber of [0, -1, 12, 2.5, 'invalid', NaN, Infinity])
      expect(normalizeSubwayConfig({ carNumber }, lines).carNumber).toBeNull();
    expect(normalizeSubwayConfig({ line: 'hibiya', carNumber: 8 }, lines).carNumber).toBeNull();
    expect(normalizeSubwayConfig({}, lines).carNumber).toBeNull();
  });
  it('loads the saved Yamanote inner-loop route unchanged from the catalogue', () => {
    expect(normalizeSubwayConfig({ line: 'yamanote', direction: 'inner' }, lines)).toMatchObject({
      line: 'yamanote',
      direction: 'inner',
      startStation: 'JY01',
      displayLanguages: 'ja-en',
    });
  });
  it('keeps unknown settings and supplies safe defaults', () => {
    const config = normalizeSubwayConfig({ unknownKey: { retained: true } }, lines);
    expect(config).toMatchObject({
      line: 'yamanote',
      direction: 'inner',
      startStation: 'JY01',
      speed: 1,
      displayLanguages: 'ja-en',
      announcementLanguages: 'ja-en',
      immersion: false,
      announcementVolume: 0.8,
      unknownKey: { retained: true },
    });
  });

  it('falls back through line-specific directions and endpoints', () => {
    expect(
      normalizeSubwayConfig({ line: 'sakaisuji', direction: 'inner', startStation: 'JY01' }, lines),
    ).toMatchObject({
      line: 'sakaisuji',
      direction: 'southbound',
      startStation: 'K11',
      displayLanguages: 'ja-kana',
    });
    expect(
      normalizeSubwayConfig(
        { line: 'hibiya', direction: 'to-naka-meguro', startStation: 'missing' },
        lines,
      ).startStation,
    ).toBe('H22');
    expect(firstStationForDirection(lines[0], 'outer')).toBe('JY30');
  });

  it('clamps volume, rejects invalid presets and validates speed without changing the station', () => {
    const config = normalizeSubwayConfig(
      {
        line: 'yamanote',
        direction: 'inner',
        startStation: 'JY20',
        speed: 3,
        displayLanguages: 'ja-ko',
        announcementLanguages: 'unknown',
        announcementVolume: 2,
        immersion: true,
      },
      lines,
    );
    expect(config).toMatchObject({
      startStation: 'JY20',
      speed: 1,
      displayLanguages: 'ja-en',
      announcementLanguages: 'ja-en',
      announcementVolume: 1,
      immersion: true,
    });
  });
});
