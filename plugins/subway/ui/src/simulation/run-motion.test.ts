import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines } from './lines';
import { createRunState, reduceRun, snapshotRun } from './run';

const files = import.meta.glob('../../../assets/lines/*/{line,pack}.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const bundle = (id: string) => {
  const of = (name: string) => files[`../../../assets/lines/${id}/${name}.json`];
  return { line: of('line'), pack: of('pack') };
};
const lines = normalizeSubwayLines({
  yamanote: bundle('yamanote'),
  hibiya: bundle('hibiya'),
  sakaisuji: bundle('sakaisuji'),
});
const reduce = (state: ReturnType<typeof createRunState>, type: 'start' | 'tick', now: number) =>
  reduceRun(state, { type }, now, lines);

describe('Subway run motion', () => {
  it('alternates coasting and notching in the cruise without moving speed, progress or arrival', () => {
    let state = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY01',
      direction: 'inner',
      dwellSeconds: 0,
    });
    state = reduce(state, 'start', 0).state;
    state = reduce(state, 'tick', 0).state;
    state = reduce(state, 'tick', 600).state;
    const segment = state.segment!;
    const cruiseStart = segment.startedAt + segment.departureMs;
    const arrival = cruiseStart + segment.cruiseMs + segment.approachMs;
    const powers = new Set<number>();
    let lastProgress = 0;
    for (let at = 600; at < arrival; at += 50) {
      state = reduce(state, 'tick', at).state;
      const sample = snapshotRun(state, at, lines);
      expect(sample.progress).toBeGreaterThanOrEqual(lastProgress);
      lastProgress = sample.progress;
      if (at < cruiseStart || at >= cruiseStart + segment.cruiseMs) continue;
      expect(sample.state).toBe('cruising');
      expect(sample.speed).toBe(60);
      const fraction =
        (at - segment.startedAt - segment.departureMs / 2) /
        (arrival - segment.startedAt - (segment.departureMs + segment.approachMs) / 2);
      expect(sample.progress).toBeCloseTo(fraction, 6);
      powers.add(sample.power);
    }
    expect([...powers].sort()).toEqual([0, 0.35]);
    expect(state.phase).toBe('approaching');
    const arrived = reduce(state, 'tick', arrival).effects;
    expect(arrived.some((effect) => effect.type === 'arrived')).toBe(true);
  });
});
