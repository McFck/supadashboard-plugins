import { isRecord } from '@supadashboard/kit';
import type { LyricLine, LyricsView } from '../lyrics';
import { parseLrc } from './lrc';
import type { Track } from './track';

/** An LRCLIB result. */
export interface LrclibRecord {
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/** With an exact title and artist, a duration this far off (s) is still the song, in a cut with other leading or trailing silence. */
const MAX_DISTANCE = 20;
/** Within this (ms) the recordings are taken as the same and the timestamps are used as they are. */
const SAME_RECORDING_MS = 2000;
/** Beyond this (ms) the cuts differ by more than leading silence, so shifting would only guess; the per-song offset corrects them. */
const MAX_SHIFT_MS = 8000;

const optionalText = (value: unknown) =>
  value === null || value === undefined || typeof value === 'string';

/** The LRCLIB result, or null when it does not have the expected shape. */
export function readRecord(raw: unknown): LrclibRecord | null {
  const r = raw;
  if (
    !isRecord(r) ||
    typeof r.trackName !== 'string' ||
    typeof r.artistName !== 'string' ||
    typeof r.duration !== 'number' ||
    typeof r.instrumental !== 'boolean' ||
    ![r.albumName, r.plainLyrics, r.syncedLyrics].every(optionalText)
  ) {
    return null;
  }
  return {
    trackName: r.trackName,
    artistName: r.artistName,
    albumName: typeof r.albumName === 'string' ? r.albumName : null,
    duration: r.duration,
    instrumental: r.instrumental,
    plainLyrics: typeof r.plainLyrics === 'string' ? r.plainLyrics : null,
    syncedLyrics: typeof r.syncedLyrics === 'string' ? r.syncedLyrics : null,
  };
}

/** Puts the whole duration difference into the leading silence, the usual difference between cuts. */
function aligned(lines: LyricLine[], shiftMs: number): LyricLine[] {
  const shift = Math.abs(shiftMs);
  if (shift > SAME_RECORDING_MS && shift <= MAX_SHIFT_MS) {
    return lines.map((line) => ({ ...line, atMs: Math.max(0, line.atMs + shiftMs) }));
  }
  return lines;
}

function view(record: LrclibRecord, durationMs: number): LyricsView {
  if (record.instrumental) {
    return { kind: 'instrumental' };
  }
  if (record.syncedLyrics) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length) {
      return {
        kind: 'synced',
        lines: aligned(lines, durationMs - Math.round(record.duration * 1000)),
      };
    }
  }
  if (record.plainLyrics?.trim()) {
    return { kind: 'plain', text: [...record.plainLyrics].slice(0, 100_000).join('') };
  }
  return { kind: 'none' };
}

function unbracketed(value: string) {
  let depth = 0;
  let result = '';
  for (const character of value) {
    if (character === '(' || character === '[') {
      depth += 1;
      result += ' ';
    } else if (character === ')' || character === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      result += character;
    }
  }
  return result;
}

const words = (value: string) =>
  value
    .replace(/[^\p{Alphabetic}\p{N}]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

export function normalized(title: string, artist: string): [string, string] {
  const clean = (value: string) => {
    let text = unbracketed(value.toLowerCase());
    for (const marker of [' feat.', ' feat ', ' ft.', ' ft ', ' featuring ']) {
      const at = text.indexOf(marker);
      if (at >= 0) {
        text = text.slice(0, at);
      }
    }
    return text;
  };
  let base = clean(title);
  for (const separator of [' - ', ' – ', ' — ']) {
    const at = base.lastIndexOf(separator);
    if (at >= 0) {
      const suffix = base.slice(at + separator.length);
      if (suffix.includes('remaster') || suffix.trim().endsWith('version')) {
        base = base.slice(0, at);
      }
    }
  }
  return [words(base), words(clean(artist).split(/[,;&]/)[0])];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const earlier = (a: number[], b: number[]) => {
  const at = a.findIndex((value, i) => value !== b[i]);
  return at >= 0 && a[at] < b[at];
};

/** The best of all candidates: the duration tier, then the exact title and album, then synced over instrumental over plain, then the closest duration. */
export function pick(records: LrclibRecord[], track: Track): LyricsView {
  const [title, artist] = normalized(track.title, track.artist);
  if (!title || !artist) {
    return { kind: 'none' };
  }
  let best: { key: number[]; view: LyricsView } | undefined;
  for (const record of records) {
    const [t, a] = normalized(record.trackName, record.artistName);
    const distance = Math.abs(record.duration - track.durationMs / 1000);
    if (
      t !== title ||
      a !== artist ||
      !Number.isFinite(record.duration) ||
      distance > MAX_DISTANCE
    ) {
      continue;
    }
    const candidate = view(record, track.durationMs);
    const rank = { synced: 0, instrumental: 1, plain: 2, none: -1 }[candidate.kind];
    if (rank < 0) {
      continue;
    }
    // The same recording, then a cut whose shift is trusted, then one whose timing stays as it is.
    const tier = [SAME_RECORDING_MS, MAX_SHIFT_MS].filter(
      (limit) => distance * 1000 > limit,
    ).length;
    const inexact =
      same(record.trackName, track.title) && same(record.albumName ?? '', track.album) ? 0 : 1;
    // Synced lyrics win over plain ones from a closer cut: the per-song offset fixes the remaining shift.
    const key = [rank, tier, inexact, distance];
    if (!best || earlier(key, best.key)) {
      best = { key, view: candidate };
    }
  }
  return best?.view ?? { kind: 'none' };
}
