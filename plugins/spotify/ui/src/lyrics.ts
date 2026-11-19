import { callPlugin, isRecord } from '@supadashboard/kit';

export type LyricLine = { atMs: number; text: string };
export type LyricsView =
  | { kind: 'synced'; lines: LyricLine[] }
  | { kind: 'plain'; text: string }
  | { kind: 'instrumental' }
  | { kind: 'none' };
export type LyricsTrack = { artist: string; title: string; album: string; durationMs: number };

/** The LRC parser's caps, in lines and code points; anything larger did not come from it. */
export const MAX_LINES = 2000;
export const MAX_LINE_LENGTH = 500;
export const MAX_PLAIN_LENGTH = 100_000;

function readLines(value: unknown): LyricLine[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_LINES) {
    return null;
  }
  const lines: LyricLine[] = [];
  for (const line of value) {
    const previous = lines.at(-1)?.atMs ?? 0;
    if (
      !isRecord(line) ||
      typeof line.atMs !== 'number' ||
      !Number.isFinite(line.atMs) ||
      line.atMs < previous ||
      typeof line.text !== 'string' ||
      // Code points, as the parser counts them; one emoji is two UTF-16 units.
      [...line.text].length > MAX_LINE_LENGTH
    ) {
      return null;
    }
    lines.push({ atMs: line.atMs, text: line.text });
  }
  return lines;
}

/** The view, or null when the payload is not one the service sends. */
export function readLyricsView(raw: unknown): LyricsView | null {
  if (!isRecord(raw)) {
    return null;
  }
  switch (raw.kind) {
    case 'synced': {
      const lines = readLines(raw.lines);
      return lines && { kind: 'synced', lines };
    }
    case 'plain':
      return typeof raw.text === 'string' &&
        raw.text.trim() &&
        [...raw.text].length <= MAX_PLAIN_LENGTH
        ? { kind: 'plain', text: raw.text }
        : null;
    case 'instrumental':
    case 'none':
      return { kind: raw.kind };
    default:
      return null;
  }
}

/** Lyrics for a track; a failed lookup or a payload that does not validate means none. */
export async function getLyrics(track: LyricsTrack): Promise<LyricsView> {
  try {
    return readLyricsView(await callPlugin('spotify', 'lyrics-get', track)) ?? { kind: 'none' };
  } catch {
    // LRCLIB or the network being down only means no lyrics this time; nothing is lost.
    return { kind: 'none' };
  }
}

/** The per-song offset's range either way (ms), as the offsets store bounds it. */
export const SONG_OFFSET_LIMIT_MS = 10_000;

/** A saved per-song offset in ms (positive shows lines earlier), or 0 when the payload is not one. */
export function readSongOffset(raw: unknown) {
  return typeof raw === 'number' && Number.isInteger(raw) && Math.abs(raw) <= SONG_OFFSET_LIMIT_MS
    ? raw
    : 0;
}

export async function getSongOffset(track: LyricsTrack) {
  try {
    return readSongOffset(await callPlugin('spotify', 'lyrics-offset-get', track));
  } catch {
    // An unreadable store only leaves the lines unshifted; the store keeps the file it could not read.
    return 0;
  }
}

/** Saves this song's offset; 0 forgets it. */
export const setSongOffset = (track: LyricsTrack, offsetMs: number) =>
  callPlugin('spotify', 'lyrics-offset-set', { ...track, offsetMs });
