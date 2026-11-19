import { isRecord } from '@supadashboard/kit';
import { validText } from './api';

export interface Track {
  artist: string;
  title: string;
  album: string;
  /** Whole seconds, as LRCLIB takes them. */
  duration: number;
  durationMs: number;
}

/** The trimmed track a lyrics call names, or null when it is not a valid one. */
export function readTrack(raw: unknown): Track | null {
  if (
    !isRecord(raw) ||
    typeof raw.artist !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.album !== 'string' ||
    typeof raw.durationMs !== 'number' ||
    !Number.isInteger(raw.durationMs) ||
    raw.durationMs < 1000 ||
    raw.durationMs > 3_600_000
  ) {
    return null;
  }
  const track: Track = {
    artist: raw.artist.trim(),
    title: raw.title.trim(),
    album: raw.album.trim(),
    duration: Math.floor((raw.durationMs + 500) / 1000),
    durationMs: raw.durationMs,
  };
  const texts = [track.artist, track.title, track.album];
  if (!track.artist || !track.title || !texts.every((text) => validText(text, 256))) {
    return null;
  }
  return track;
}
