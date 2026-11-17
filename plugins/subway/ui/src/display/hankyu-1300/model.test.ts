import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines, stepStation } from '../../simulation/lines';
import type { RunSnapshot } from '../../simulation/run';
import { scheduleScreen } from '../../rendering/screens';
import { sakaisujiNearbyStations } from './model';

const lineFiles = import.meta.glob<unknown>('../../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
});
const packFiles = import.meta.glob<unknown>('../../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
});
const lines = normalizeSubwayLines(
  ['yamanote', 'hibiya', 'sakaisuji'].map((id) => ({
    line: Object.entries(lineFiles).find(([path]) => path.endsWith(`/lines/${id}/line.json`))?.[1],
    pack: Object.entries(packFiles).find(([path]) => path.endsWith(`/lines/${id}/pack.json`))?.[1],
  })),
);
const sakaisuji = lines.find((line) => line.id === 'sakaisuji');
if (!sakaisuji) {
  throw new Error('Missing Sakaisuji fixture');
}

function model(station: string, direction: string) {
  if (!sakaisuji) {
    throw new Error('Missing Sakaisuji fixture');
  }
  const next = stepStation(sakaisuji, station, direction)?.code ?? '';
  const snapshot: RunSnapshot = {
    station,
    next,
    state: 'cruising',
    line: 'sakaisuji',
    direction,
    doorSide: 'unknown',
    doors: 'closed',
    speed: 42,
    power: 0.35,
    brake: 0,
    progress: 0.5,
    paused: false,
    immersion: false,
    generation: 1,
    multiplier: 1,
    remainingMinutes: 9,
  };
  return scheduleScreen(snapshot, { line: sakaisuji, languages: ['ja', 'kana'] }, 0);
}

describe('Hankyu nearby route window', () => {
  it.each([
    ['K11', 'southbound', ['K11', 'K12', 'K13', 'K14', 'K15', 'K16']],
    ['K15', 'southbound', ['K14', 'K15', 'K16', 'K17', 'K18', 'K19']],
    ['K20', 'southbound', ['K15', 'K16', 'K17', 'K18', 'K19', 'K20']],
    ['K20', 'northbound', ['K20', 'K19', 'K18', 'K17', 'K16', 'K15']],
    ['K15', 'northbound', ['K16', 'K15', 'K14', 'K13', 'K12', 'K11']],
    ['K11', 'northbound', ['K16', 'K15', 'K14', 'K13', 'K12', 'K11']],
  ])('keeps the current stop visible at %s toward %s', (station, direction, expected) => {
    expect(sakaisujiNearbyStations(model(station, direction)).map((stop) => stop.code)).toEqual(
      expected,
    );
  });
});
