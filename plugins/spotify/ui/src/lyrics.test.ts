import { expect, it } from 'vitest';
import { readLyricsView, readSongOffset } from './lyrics';

const synced = (lines: unknown) => ({ kind: 'synced', lines });

it('accepts the views the native side sends', () => {
  const lines = [
    { atMs: 0, text: '' },
    { atMs: 1200, text: 'First' },
    { atMs: 1200, text: '🎵'.repeat(500) },
  ];
  expect(readLyricsView(synced(lines))).toEqual(synced(lines));
  expect(readLyricsView({ kind: 'plain', text: 'Words' })).toEqual({
    kind: 'plain',
    text: 'Words',
  });
  expect(readLyricsView({ kind: 'instrumental', extra: 1 })).toEqual({ kind: 'instrumental' });
});

it('rejects payloads that would break line sync or flood the tile', () => {
  for (const raw of [
    null,
    { kind: 'karaoke' },
    synced([]),
    synced([
      { atMs: 2000, text: 'b' },
      { atMs: 1000, text: 'a' },
    ]),
    synced([{ atMs: Number.NaN, text: 'a' }]),
    synced([{ atMs: -1, text: 'a' }]),
    synced([{ atMs: 0, text: 7 }]),
    synced([{ atMs: 0, text: 'x'.repeat(501) }]),
    synced(Array.from({ length: 2001 }, (_, atMs) => ({ atMs, text: '' }))),
    { kind: 'plain', text: '  ' },
    { kind: 'plain', text: 'x'.repeat(100_001) },
  ]) {
    expect(readLyricsView(raw)).toBeNull();
  }
});

it('reads a saved song offset only when the native store could have written it', () => {
  expect(readSongOffset(-10_000)).toBe(-10_000);
  for (const raw of [10_001, 1.5, Number.NaN, '100', null]) {
    expect(readSongOffset(raw)).toBe(0);
  }
});
