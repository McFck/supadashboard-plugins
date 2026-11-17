import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines, stepStation } from '../../simulation/lines';
import type { RunSnapshot } from '../../simulation/run';
import { hibiyaPanelStations, hibiyaRouteWindow } from './model';
import { scheduleHibiyaPair } from './schedule';
const lineFiles = import.meta.glob('../../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const packFiles = import.meta.glob('../../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const lines = normalizeSubwayLines(
  ['yamanote', 'hibiya', 'sakaisuji'].map((id) => ({
    line: Object.entries(lineFiles).find(([path]) => path.endsWith(`/lines/${id}/line.json`))?.[1],
    pack: Object.entries(packFiles).find(([path]) => path.endsWith(`/lines/${id}/pack.json`))?.[1],
  })),
);
const fixtureLine = lines.find((line) => line.id === 'hibiya');
if (!fixtureLine) {
  throw new Error('Hibiya fixture is missing');
}
const hibiya = fixtureLine;

function snapshot(station = 'H14', direction = 'to-kita-senju', next?: string): RunSnapshot {
  const following = next ?? stepStation(hibiya, station, direction)?.code ?? '';
  return {
    station,
    next: following,
    state: 'cruising',
    line: 'hibiya',
    direction,
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
    remainingMinutes: 12,
  };
}

describe('Tokyo Metro 13000 route window', () => {
  it('windows route stops in order without duplicate seam stations or invented terminal stops', () => {
    for (const direction of hibiya.directions) {
      for (const station of hibiya.stations) {
        const model = scheduleHibiyaPair(
          snapshot(station.code, direction.id),
          { line: hibiya, languages: ['ja'] },
          0,
        ).left;
        const window = hibiyaRouteWindow(model);
        const left = hibiyaPanelStations(window, 0);
        const right = hibiyaPanelStations(window, 1);
        const shown = [...left, ...right];
        const codes = shown.map((item) => item.code);
        expect(left.length).toBeLessThanOrEqual(8);
        expect(right.length).toBeLessThanOrEqual(8);
        expect(codes).toHaveLength(16);
        expect(codes).toContain(station.code);
        expect(new Set(codes).size).toBe(codes.length);
        const ordered = direction.delta > 0 ? [...hibiya.stations] : [...hibiya.stations].reverse();
        const currentIndex = ordered.findIndex((item) => item.code === station.code);
        const start = Math.max(0, Math.min(currentIndex - 2, ordered.length - 16));
        expect(codes).toEqual(ordered.slice(start, start + 16).map((item) => item.code));
        expect(model.route.at(-1)?.code).toBe(
          direction.delta > 0 ? hibiya.stations.at(-1)?.code : hibiya.stations[0].code,
        );
      }
    }
  });
});
