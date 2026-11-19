import type { LyricsView } from '../lyrics';
import { cacheKey, NEGATIVE_TTL, readCache, writeCache } from './lyrics-cache';
import { LrclibClient } from './lrclib';
import type { Track } from './track';

const MEMORY_ENTRIES = 32;
/** A failed lookup is not repeated for this long (s). */
const FAILURE_TTL = 5;

type Entry = { key: string; at: number; result: { view: LyricsView } | { error: unknown } };

const seconds = () => Math.floor(Date.now() / 1000);

function unwrap({ result }: Entry): LyricsView {
  if ('error' in result) {
    throw result.error;
  }
  return result.view;
}

export class LyricsHub {
  private entries: Entry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private client = new LrclibClient();

  get(track: Track): Promise<LyricsView> {
    const run = this.queue.then(() => this.lookup(track));
    this.queue = run.catch(() => {});
    return run;
  }

  private async lookup(track: Track): Promise<LyricsView> {
    const key = await cacheKey(track);
    const now = seconds();
    const known = this.entries.find((entry) => {
      if (entry.key !== key) {
        return false;
      }
      const age = now - entry.at;
      if ('error' in entry.result) {
        return age < FAILURE_TTL;
      }
      return entry.result.view.kind === 'none' ? age < NEGATIVE_TTL : true;
    });
    if (known) {
      return unwrap(known);
    }
    let result: Entry['result'];
    const cached = await readCache(key, now);
    if (cached) {
      result = { view: cached };
    } else {
      try {
        const view = await this.client.fetch(track);
        result = { view };
        await writeCache(key, view, now).catch(() => {
          // Lyrics remain usable when this disposable cache cannot be written.
        });
      } catch (error) {
        result = { error };
      }
    }
    this.entries = this.entries.filter((entry) => entry.key !== key);
    if (this.entries.length === MEMORY_ENTRIES) {
      this.entries.shift();
    }
    const entry = { key, at: now, result };
    this.entries.push(entry);
    return unwrap(entry);
  }
}
