import { pluginStorage } from '@supadashboard/kit';
import { readLyricsView, type LyricsView } from '../lyrics';
import type { Track } from './track';

/** How long a "no lyrics found" result is trusted (s). */
export const NEGATIVE_TTL = 300;
const VERSION = 3;
const MAX_FILES = 3000;
const MAX_BYTES = 8 * 1024 * 1024;
const DIR = 'lyrics';

/** SHA-256 of the track's identity as JSON, which also keys the song's offset. */
export async function cacheKey(track: Track) {
  const identity = JSON.stringify([track.artist, track.title, track.album, track.duration]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The cached result, or null when it is missing, corrupt, expired or from a lookup that is retried now. */
export async function readCache(key: string, now: number): Promise<LyricsView | null> {
  let text: string | null;
  try {
    text = await pluginStorage.read('spotify', `${DIR}/${key}.json`);
  } catch {
    // An unreadable cache file only means a fresh lookup.
    return null;
  }
  if (text === null || text.length > MAX_BYTES) {
    return null;
  }
  let entry: { version?: unknown; fetchedAt?: unknown; result?: unknown };
  try {
    entry = JSON.parse(text);
  } catch {
    return null;
  }
  const result = readLyricsView(entry?.result);
  const { version, fetchedAt } = entry ?? {};
  if (
    !result ||
    typeof version !== 'number' ||
    !(version >= 1 && version <= VERSION) ||
    typeof fetchedAt !== 'number' ||
    fetchedAt > now ||
    // Older lookups rejected synced lyrics of other cuts; keep their synced results and retry the rest.
    (version < VERSION && (result.kind === 'none' || result.kind === 'plain')) ||
    (result.kind === 'none' && now - fetchedAt >= NEGATIVE_TTL)
  ) {
    return null;
  }
  return result;
}

/** Saves a result and drops the oldest files beyond the limit. */
export async function writeCache(key: string, result: LyricsView, fetchedAt: number) {
  await pluginStorage.write(
    'spotify',
    `${DIR}/${key}.json`,
    JSON.stringify({ version: VERSION, fetchedAt, result }),
  );
  const files = (await pluginStorage.list('spotify', DIR))
    .filter((file) => file.name.endsWith('.json'))
    .sort((a, b) => a.modified - b.modified);
  for (const file of files.slice(0, Math.max(0, files.length - MAX_FILES))) {
    await pluginStorage.remove('spotify', `${DIR}/${file.name}`);
  }
}
