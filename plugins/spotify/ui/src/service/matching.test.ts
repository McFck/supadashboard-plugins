import { expect, it } from 'vitest';
import { normalized, pick, type LrclibRecord } from './matching';
import { readTrack } from './track';

function record(title: string, artist: string, duration: number, synced: boolean): LrclibRecord {
  return {
    trackName: title,
    artistName: artist,
    albumName: null,
    duration,
    instrumental: false,
    plainLyrics: 'plain',
    syncedLyrics: synced ? '[00:10.00]line' : null,
  };
}
function track(artist: string, title: string, album: string, durationMs: number) {
  const read = readTrack({ artist, title, album, durationMs });
  if (!read) {
    throw new Error('invalid track');
  }
  return read;
}
const firstLine = (view: ReturnType<typeof pick>) =>
  view.kind === 'synced' ? view.lines[0].atMs : null;

it('prefers synced lyrics, then the closest cut and exact album, and aligns other cuts', () => {
  const t = track('Sizor', 'Холодные стены', 'Холодные стены', 195_863);
  const records = [
    record('Холодные стены', 'Sizor', 188, true),
    record('Холодные стены', 'Sizor', 196, false),
    record('Холодные стены', 'Sizor', 201, true),
  ];
  // LRCLIB's 201 s cut is 5.137 s longer, so its lines come that much earlier.
  expect(firstLine(pick([records[0], records[2]], t))).toBe(4_863);
  expect(firstLine(pick(records.slice(0, 1), t))).toBe(17_863);
  // Synced lyrics from another cut win over plain lyrics from the same recording.
  expect(firstLine(pick(records, t))).toBe(4_863);
  const album = {
    ...record('Холодные стены', 'Sizor', 196.5, true),
    syncedLyrics: '[00:01.00]album',
    albumName: 'холодные стены',
  };
  const other = () => record('Холодные стены', 'Sizor', 196, true);
  expect(firstLine(pick([other(), album], t))).toBe(1_000);
  expect(firstLine(pick([{ ...other(), syncedLyrics: null }, other()], t))).toBe(10_000);
});

it('matches Cyrillic, case and collaborators without accepting other songs', () => {
  const t = track(
    'SIZOR feat. Гость',
    'ХОЛОДНЫЕ СТЕНЫ (feat. Гость) [Deluxe] - Remastered 2024',
    'Another album',
    196_000,
  );
  expect(normalized(t.title, t.artist)).toEqual(['холодные стены', 'sizor']);
  expect(normalized('ПЕСНЯ [2024]', 'ГРУППА, Гость')).toEqual(['песня', 'группа']);
  const wrong = [
    record('Другие стены', 'Sizor', 196, true),
    record('Холодные стены', 'Другой', 196, true),
  ];
  const right = [
    record('Холодные стены', 'Sizor', 197, true),
    record('Холодные стены', 'Sizor', 196, false),
  ];
  expect(pick([...wrong, ...right], t).kind).toBe('synced');
  expect(pick(wrong, t)).toEqual({ kind: 'none' });
});

it('keeps timestamps of the same recording and bounds other cuts', () => {
  const t = track('Artist', 'Song', '', 100_000);
  expect(firstLine(pick([record('Song', 'Artist', 101.5, true)], t))).toBe(10_000);
  expect(firstLine(pick([record('Song', 'Artist', 107.5, true)], t))).toBe(2_500);
  // A gap beyond what leading silence explains keeps the timestamps for the per-song offset to fix.
  expect(firstLine(pick([record('Song', 'Artist', 115, true)], t))).toBe(10_000);
  const far = { ...record('Song', 'Artist', 120.5, true), plainLyrics: null };
  expect(pick([far], t)).toEqual({ kind: 'none' });
  expect(pick([record('Song', 'Artist', 80, false)], t)).toEqual({ kind: 'plain', text: 'plain' });
  expect(pick([record('Song', 'Artist', NaN, true)], t)).toEqual({ kind: 'none' });
  const instrumental = { ...record('Song', 'Artist', 100, false), instrumental: true };
  expect(pick([instrumental], t)).toEqual({ kind: 'instrumental' });
});

it('rejects invalid lyrics tracks before fetching', () => {
  for (const [artist, title, durationMs] of [
    ['', 'title', 1000],
    ['artist', '\ntitle\0', 1000],
    ['artist', 'title', 0],
    ['artist', 'title', Number.MAX_SAFE_INTEGER],
    ['a'.repeat(257), 'title', 1000],
  ] as const) {
    expect(readTrack({ artist, title, album: '', durationMs })).toBeNull();
  }
});
