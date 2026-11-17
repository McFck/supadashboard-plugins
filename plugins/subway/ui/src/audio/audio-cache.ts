import type { ResolvedCue } from './sound-types';

const CACHE_LIMIT = 32 * 1024 * 1024;

type CachedBuffer = { buffer: AudioBuffer; bytes: number };

export interface CueBufferCacheHost {
  fetch: typeof fetch;
  /** The context buffers must be decoded for; a decode finishing for another one is dropped. */
  context(): AudioContext | undefined;
  disposed(): boolean;
  warnOnce(key: string, error: unknown): void;
}

/** Decoded cue buffers, LRU-pruned to a byte budget; buffers of playing sources are pinned. */
export function createCueBufferCache(host: CueBufferCacheHost) {
  let bytesUsed = 0;
  let hits = 0;
  const cache = new Map<string, CachedBuffer>();
  const pending = new Map<string, Promise<AudioBuffer | undefined>>();
  const pinned = new Map<string, number>();

  function pin(url: string | undefined, delta: number) {
    if (!url) return;
    const next = (pinned.get(url) ?? 0) + delta;
    if (next > 0) pinned.set(url, next);
    else pinned.delete(url);
  }

  function prune() {
    if (bytesUsed <= CACHE_LIMIT) return;
    for (const [url, entry] of cache) {
      if (bytesUsed <= CACHE_LIMIT) break;
      if (pinned.has(url)) continue;
      cache.delete(url);
      bytesUsed -= entry.bytes;
    }
  }

  async function decode(cue: ResolvedCue): Promise<AudioBuffer | undefined> {
    const audioContext = host.context();
    if (!audioContext || host.disposed()) return undefined;
    const existing = cache.get(cue.url);
    if (existing) {
      cache.delete(cue.url);
      cache.set(cue.url, existing);
      hits++;
      return existing.buffer;
    }
    const underway = pending.get(cue.url);
    if (underway) return underway;
    const task = (async () => {
      try {
        const response = await host.fetch(cue.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        if (host.disposed() || audioContext !== host.context()) return undefined;
        const bytes = buffer.length * buffer.numberOfChannels * 4;
        cache.set(cue.url, { buffer, bytes });
        bytesUsed += bytes;
        prune();
        return buffer;
      } catch (error) {
        host.warnOnce(cue.url, error);
        return undefined;
      } finally {
        pending.delete(cue.url);
      }
    })();
    pending.set(cue.url, task);
    return task;
  }

  function clear() {
    cache.clear();
    pending.clear();
    pinned.clear();
    bytesUsed = 0;
  }

  return {
    decode,
    pin,
    prune,
    clear,
    hits: () => hits,
  };
}
