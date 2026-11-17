import { pluginStorage } from '@supadashboard/kit';
import { cacheKey } from './lyrics-cache';
import type { Track } from './track';

/** Largest offset either way (ms), the tile slider's range. */
const LIMIT_MS = 10_000;
/** Songs kept; setting one more forgets the one set longest ago. */
const MAX_ENTRIES = 500;
const VERSION = 1;
const FILE = 'lyrics-offsets.json';

/** Oldest first; a song is never listed twice and never with 0. */
type Entries = [string, number][];

const valid = (key: unknown, offsetMs: unknown): offsetMs is number =>
  typeof key === 'string' &&
  /^[0-9a-fA-F]{64}$/.test(key) &&
  typeof offsetMs === 'number' &&
  Number.isInteger(offsetMs) &&
  offsetMs !== 0 &&
  Math.abs(offsetMs) <= LIMIT_MS;

function limited(entries: Entries) {
  return entries.slice(Math.max(0, entries.length - MAX_ENTRIES));
}

/** The saved offsets without the entries no build of this store writes. An unreadable file is kept as `.bad`. */
async function load(): Promise<Entries> {
  const text = await pluginStorage.read('spotify', FILE);
  if (text === null) {
    return [];
  }
  let stored: { version?: unknown; entries?: unknown } | null = null;
  try {
    stored = JSON.parse(text);
  } catch {
    // Handled below like any other unreadable file.
  }
  if (stored?.version !== VERSION || !Array.isArray(stored.entries)) {
    await pluginStorage.write('spotify', `${FILE}.bad`, text);
    return [];
  }
  const entries: Entries = [];
  for (const entry of stored.entries) {
    const [key, offsetMs] = Array.isArray(entry) ? entry : [];
    if (valid(key, offsetMs)) {
      const at = entries.findIndex(([other]) => other === key);
      if (at >= 0) {
        entries.splice(at, 1);
      }
      entries.push([key, offsetMs]);
    }
  }
  return limited(entries);
}

/** `entries` with `key` set to `offsetMs` as the newest entry, or removed for 0. */
export function withOffset(entries: Entries, key: string, offsetMs: number): Entries {
  const next = entries.filter(([other]) => other !== key);
  if (offsetMs !== 0) {
    next.push([key, offsetMs]);
  }
  return limited(next);
}

export class LyricsOffsets {
  private entries: Promise<Entries> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  /** Runs `job` after the earlier ones, on the offsets loaded on first use. */
  private locked<T>(job: (entries: Entries) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      this.entries ??= load();
      try {
        return await job(await this.entries);
      } catch (error) {
        // A failed first load is tried again by the next call.
        this.entries = undefined;
        throw error;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async get(track: Track): Promise<number> {
    const key = await cacheKey(track);
    return this.locked(async (entries) => entries.find(([other]) => other === key)?.[1] ?? 0);
  }

  async set(track: Track, offsetMs: number): Promise<void> {
    if (!Number.isInteger(offsetMs) || Math.abs(offsetMs) > LIMIT_MS) {
      throw new Error('Invalid lyrics offset');
    }
    const key = await cacheKey(track);
    await this.locked(async (entries) => {
      const next = withOffset(entries, key, offsetMs);
      await pluginStorage.write(
        'spotify',
        FILE,
        JSON.stringify({ version: VERSION, entries: next }),
      );
      // Only a saved change is kept, so memory never claims what the file does not hold.
      this.entries = Promise.resolve(next);
    });
  }
}
