import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines, stepStation } from '../simulation/lines';
import { scheduleScreen } from './screens';
import type { RunSnapshot } from '../simulation/run';

const lineFiles = import.meta.glob('../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const packFiles = import.meta.glob('../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const ids = ['yamanote', 'hibiya', 'sakaisuji'] as const;
const lines = normalizeSubwayLines(
  ids.map((id) => {
    const line = Object.entries(lineFiles).find(([path]) =>
      path.endsWith(`/lines/${id}/line.json`),
    )?.[1];
    const pack = Object.entries(packFiles).find(([path]) =>
      path.endsWith(`/lines/${id}/pack.json`),
    )?.[1];
    if (!line || !pack) throw new Error(`Missing screen fixtures for ${id}`);
    return { line, pack };
  }),
);

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    station: 'JY01',
    next: 'JY02',
    state: 'cruising',
    line: 'yamanote',
    direction: 'inner',
    doorSide: 'unknown',
    doors: 'closed',
    speed: 48,
    power: 0.35,
    brake: 0,
    progress: 0.4,
    paused: false,
    immersion: false,
    generation: 1,
    multiplier: 1,
    remainingMinutes: 38,
    ...overrides,
  };
}

const yamanote = lines[0];
const config = { line: yamanote, languages: ['ja', 'en'] } as const;

describe('Subway screen scheduler', () => {
  it('cycles broad, nearby and useful transfer pages with exact visible-time boundaries', () => {
    const withTransfers = snapshot({ station: 'JY01', next: 'JY02' });
    expect(scheduleScreen(withTransfers, config, 0).page).toBe('broad');
    expect(scheduleScreen(withTransfers, config, 11_999).page).toBe('broad');
    expect(scheduleScreen(withTransfers, config, 12_000).page).toBe('nearby');
    expect(scheduleScreen(withTransfers, config, 23_999).page).toBe('nearby');
    expect(scheduleScreen(withTransfers, config, 48_000).page).toBe('transfers');
    expect(scheduleScreen(withTransfers, config, 59_999).page).toBe('transfers');
    expect(scheduleScreen(withTransfers, config, 60_000).page).toBe('platform');
  });

  it('skips a transfer page when the upcoming station has no connections', () => {
    const station = yamanote.stations.find(
      (item) => stepStation(yamanote, item.code, 'inner')?.transfers.length === 0,
    )!;
    const next = stepStation(yamanote, station.code, 'inner')!;
    const noTransfer = snapshot({ station: station.code, next: next.code });
    const schedule = scheduleScreen(noTransfer, config, 16_000);
    expect(schedule.page).toBe('nearby');
    expect(schedule.pageDeadline).toBe(24_000);
    expect(schedule.nextDeadline).toBe(18_000);
  });

  it('pins incident and arrival phases above manual map and ordinary cycling', () => {
    expect(
      scheduleScreen(snapshot({ state: 'approaching' }), { ...config, manualView: 'map' }, 0).page,
    ).toBe('door');
    expect(scheduleScreen(snapshot({ state: 'doorsClosing' }), config, 0).page).toBe('broad');
    expect(
      scheduleScreen(snapshot({ state: 'emergency' }), { ...config, manualView: 'map' }, 44_000)
        .page,
    ).toBe('emergency');
    expect(scheduleScreen(snapshot({ state: 'suspended' }), config, 44_000).page).toBe(
      'suspension',
    );
  });

  it('rotates the native header every three seconds independently of the optional area', () => {
    const atZero = scheduleScreen(snapshot(), config, 0);
    const before = scheduleScreen(snapshot(), config, 5_999);
    const atSix = scheduleScreen(snapshot(), config, 6_000);
    expect([atZero.page, before.page, atSix.page]).toEqual(['broad', 'broad', 'broad']);
    expect(atZero.language).toBe('ja');
    expect(atSix.language).toBe('ja');
    expect(scheduleScreen(snapshot(), config, 3_000).headerLanguage).toBe('en');
    expect(scheduleScreen(snapshot(), config, 24_000).language).toBe('en');
    expect(atSix.languageDeadline).toBe(9_000);
    expect(atSix.nextDeadline).toBe(9_000);
    expect(scheduleScreen(snapshot({ state: 'emergency' }), config, 6_000).languages).toEqual([
      'ja',
      'en',
      'zh',
      'ko',
    ]);
  });

  it('supports Hibiya kanji, kana and four-language headers with a one-locale panel offset', () => {
    const hibiya = lines.find((line) => line.id === 'hibiya')!;
    const current = snapshot({
      line: 'hibiya',
      station: 'H14',
      next: 'H15',
      direction: 'to-kita-senju',
    });
    const pair = { line: hibiya, languages: ['ja', 'en', 'zh', 'ko'] };
    expect(scheduleScreen(current, { line: hibiya, languages: ['kana'] }, 0).language).toBe('kana');
    expect(scheduleScreen(current, pair, 0).language).toBe('ja');
    expect(scheduleScreen(current, { ...pair, languageOffset: 1 }, 0).language).toBe('en');
    expect(scheduleScreen(current, { ...pair, languageOffset: 1 }, 6_000).language).toBe('zh');
    expect(
      scheduleScreen(current, { line: hibiya, languages: ['ja'], languageOffset: 1 }, 0).language,
    ).toBe('ja');
    expect(scheduleScreen(current, pair, 0).pageDeadline).toBe(
      scheduleScreen(current, { ...pair, languageOffset: 1 }, 0).pageDeadline,
    );
  });

  it('uses Hibiya route guidance as the second stopped page and keeps transfers six seconds', () => {
    const hibiya = lines.find((line) => line.id === 'hibiya')!;
    const hibiyaConfig = { line: hibiya, languages: ['ja', 'en'] };
    const stopped = snapshot({
      line: 'hibiya',
      station: 'H13',
      next: 'H14',
      state: 'stopped',
      direction: 'to-kita-senju',
    });
    const cruising = { ...stopped, state: 'cruising' as const };
    expect(scheduleScreen(stopped, hibiyaConfig, 0).page).toBe('platform');
    expect(scheduleScreen(stopped, hibiyaConfig, 6_000).page).toBe('broad');
    expect(scheduleScreen(cruising, hibiyaConfig, 0).page).toBe('broad');
    expect(scheduleScreen(cruising, hibiyaConfig, 8_000).page).toBe('transfers');
    expect(scheduleScreen(cruising, hibiyaConfig, 13_999).page).toBe('transfers');
    expect(scheduleScreen(cruising, hibiyaConfig, 14_000).page).toBe('broad');
    const noTransferStation = hibiya.stations.find(
      (station) => stepStation(hibiya, station.code, 'to-kita-senju')?.transfers.length === 0,
    )!;
    const noTransferNext = stepStation(hibiya, noTransferStation.code, 'to-kita-senju')!;
    const noTransfers = { ...cruising, station: noTransferStation.code, next: noTransferNext.code };
    expect(scheduleScreen(noTransfers, hibiyaConfig, 8_000).page).toBe('nearby');
  });

  it('limits Sakaisuji normal display rotation to kanji and kana', () => {
    const sakaisuji = lines.find((line) => line.id === 'sakaisuji')!;
    const current = snapshot({
      line: 'sakaisuji',
      station: 'K12',
      next: 'K13',
      direction: 'southbound',
    });
    const pair = { line: sakaisuji, languages: ['ja', 'kana'] };
    expect(scheduleScreen(current, pair, 0).language).toBe('ja');
    expect(scheduleScreen(current, pair, 6_000).language).toBe('kana');
    expect(scheduleScreen(current, { line: sakaisuji, languages: ['en'] }, 0).languages).toEqual([
      'ja',
      'kana',
    ]);
  });

  it('mirrors route ordering, resolves destinations and keeps progress out of the static cache key', () => {
    const inner = scheduleScreen(snapshot({ station: 'JY01', next: 'JY02' }), config, 0);
    const outer = scheduleScreen(
      snapshot({ station: 'JY01', next: 'JY30', direction: 'outer' }),
      config,
      0,
    );
    expect(inner.route).toHaveLength(30);
    expect(inner.route.slice(0, 3).map((station) => station.code)).toEqual([
      'JY01',
      'JY02',
      'JY03',
    ]);
    expect(outer.route.slice(0, 3).map((station) => station.code)).toEqual([
      'JY01',
      'JY30',
      'JY29',
    ]);
    expect(inner.destination).toBeTruthy();
    expect(scheduleScreen(snapshot({ progress: 0.5 }), config, 0).invalidationKey).toBe(
      scheduleScreen(snapshot({ progress: 0.9 }), config, 0).invalidationKey,
    );
  });

  it('returns a frozen page model and frozen snapshot/collections', () => {
    const schedule = scheduleScreen(snapshot(), config, 0);
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule.snapshot)).toBe(true);
    expect(Object.isFrozen(schedule.languages)).toBe(true);
    expect(Object.isFrozen(schedule.transfers)).toBe(true);
    expect(Object.isFrozen(schedule.route)).toBe(true);
    expect(Object.isFrozen(schedule.nearby)).toBe(true);
  });

  it('holds unknown door side without a claim and derives explicit viewing-side labels', () => {
    const unknown = lines
      .flatMap((line) =>
        line.stations.flatMap((station) =>
          line.directions.map((direction) => ({ line, station, direction })),
        ),
      )
      .find((item) => item.station.doorByDirection[item.direction.id]?.side === 'unknown')!;
    const unknownSnapshot = snapshot({
      line: unknown.line.id,
      station: unknown.station.code,
      next: '',
      direction: unknown.direction.id,
    });
    expect(scheduleScreen(unknownSnapshot, { line: unknown.line }, 0).sideLabel).toBeNull();

    const known = lines
      .flatMap((line) =>
        line.stations.flatMap((station) =>
          line.directions.map((direction) => ({ line, station, direction })),
        ),
      )
      .find((item) => item.station.doorByDirection[item.direction.id]?.side === 'right')!;
    const knownSnapshot = snapshot({
      line: known.line.id,
      station: known.station.code,
      next: '',
      direction: known.direction.id,
    });
    expect(
      scheduleScreen(knownSnapshot, { line: known.line, viewingSide: 'right' }, 0).sideLabel,
    ).toBe('this side');
    expect(
      scheduleScreen(knownSnapshot, { line: known.line, viewingSide: 'left' }, 0).sideLabel,
    ).toBe('opposite side');
  });
});
