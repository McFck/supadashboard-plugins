import { expect, it } from 'vitest';
import type { NowPlayingSession } from '@supadashboard/kit';
import { lineAt, offsetOf, positionAt } from './lyric-clock';

const session = (state: NowPlayingSession['state'], rate?: number): NowPlayingSession => ({
  sessionId: 's',
  title: 'Song',
  artist: 'Band',
  album: '',
  state,
  current: true,
  timeline: { positionMs: 10_000, startMs: 0, endMs: 60_000, sampledAtMs: 1_000_000, rate },
});
const lines = [1000, 5000, 9000].map((atMs) => ({ atMs, text: `${atMs}` }));

it('picks the sung line from the extrapolated position, so lyrics stay in sync', () => {
  const cases: [string, NowPlayingSession, number, number, number | null, number][] = [
    ['playing', session('playing'), 1_002_000, 0, 12_000, 2],
    ['paused freezes', session('paused'), 1_002_000, 0, 10_000, 2],
    ['rate', session('playing', 2), 1_001_000, 0, 12_000, 2],
    ['clamped at the end', session('playing'), 9_000_000, 0, 60_000, 2],
    ['offset', session('playing'), 1_000_000, -6_000, 4_000, 0],
    ['lead-in at a boundary', session('playing'), 1_000_000, -5_150, 4_850, 1],
    ['before the first line', session('playing'), 1_000_000, -9_500, 500, -1],
  ];
  for (const [name, input, now, offset, position, index] of cases) {
    const at = positionAt(input, now, offset);
    expect([name, at, at === null ? null : lineAt(lines, at)]).toEqual([name, position, index]);
  }
  expect(lineAt([], 5000)).toBe(-1);
  expect(positionAt({ ...session('playing'), timeline: undefined }, 0, 0)).toBeNull();
});

it('reads a stored offset only within ±2 s', () => {
  expect([
    offsetOf({ offsetMs: 300 }),
    offsetOf({ offsetMs: -9000 }),
    offsetOf({ offsetMs: 'x' }),
  ]).toEqual([300, -2000, 0]);
});
