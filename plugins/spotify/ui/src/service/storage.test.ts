import { beforeEach, expect, it, vi } from 'vitest';
import type { PluginService } from '@supadashboard/kit';

type Stored = { text: string; modified: number };
const provided = vi.hoisted((): { service?: PluginService } => ({}));
const files = vi.hoisted(() => new Map<string, Stored>());
vi.mock('@supadashboard/kit', async (original) => ({
  ...(await original<object>()),
  providePlugin: (_id: string, service: PluginService) => {
    provided.service = service;
    return () => {};
  },
  pluginStorage: {
    read: async (_plugin: string, path: string) => files.get(path)?.text ?? null,
    write: async (_plugin: string, path: string, text: string) => {
      files.set(path, { text, modified: files.size + 1 });
    },
    remove: async (_plugin: string, path: string) => void files.delete(path),
    list: async (_plugin: string, dir: string) =>
      [...files]
        .filter(([path]) => path.startsWith(`${dir}/`))
        .map(([path, file]) => ({
          name: path.slice(dir.length + 1),
          size: file.text.length,
          modified: file.modified,
        })),
  },
}));

const { NEGATIVE_TTL, cacheKey, readCache, writeCache } = await import('./lyrics-cache');
const { LyricsOffsets, withOffset } = await import('./offsets');
const { provideSpotify } = await import('./index');

async function serviceUnderTest() {
  provideSpotify();
  const service = provided.service;
  if (!service) {
    throw new Error('service not provided');
  }
  return service;
}

const entry = (version: number, result: object, fetchedAt = 100) =>
  JSON.stringify({ version, fetchedAt, result });
const put = (path: string, text: string, modified = 1) => files.set(path, { text, modified });
const key = (n: number) => n.toString(16).padStart(64, '0');
const song = { artist: 'Artist', title: 'Song', album: '', duration: 100, durationMs: 100_000 };

beforeEach(() => files.clear());

it('round-trips cached results, expires misses and ignores corruption', async () => {
  await writeCache('positive', { kind: 'plain', text: 'hello' }, 100);
  expect(await readCache('positive', 999_999)).toEqual({ kind: 'plain', text: 'hello' });
  await writeCache('negative', { kind: 'none' }, 100);
  expect(await readCache('negative', 100 + NEGATIVE_TTL - 1)).toEqual({ kind: 'none' });
  expect(await readCache('negative', 100 + NEGATIVE_TTL)).toBeNull();
  put('lyrics/old-negative.json', entry(1, { kind: 'none' }));
  expect(await readCache('old-negative', 100)).toBeNull();
  put('lyrics/old-instrumental.json', entry(2, { kind: 'instrumental' }));
  expect(await readCache('old-instrumental', 100)).toEqual({ kind: 'instrumental' });
  put('lyrics/old-plain.json', entry(2, { kind: 'plain', text: 'hello' }));
  expect(await readCache('old-plain', 100)).toBeNull();
  put('lyrics/positive.json', 'broken');
  expect(await readCache('positive', 100)).toBeNull();
});

it('reads a v2 cache entry written by the native plugin', async () => {
  const lines = [
    { atMs: 1000, text: 'a' },
    { atMs: 2000, text: 'b' },
  ];
  put('lyrics/native.json', entry(2, { kind: 'synced', lines }));
  expect(await readCache('native', 500)).toEqual({ kind: 'synced', lines });
});

it('keeps at most 3,000 cache files, dropping the least recently written', async () => {
  for (let n = 0; n < 3000; n++) {
    put(`lyrics/${key(n)}.json`, '{}', n + 1);
  }
  await writeCache('fresh', { kind: 'instrumental' }, 100);
  expect([...files.keys()].filter((path) => path.startsWith('lyrics/'))).toHaveLength(3000);
  expect(files.has(`lyrics/${key(0)}.json`)).toBe(false);
  expect(files.has('lyrics/fresh.json')).toBe(true);
});

it('keeps the newest 500 song offsets and drops reset ones', () => {
  let entries: [string, number][] = [];
  for (let n = 0; n <= 500; n++) {
    entries = withOffset(entries, key(n), 100);
  }
  expect(entries).toHaveLength(500);
  expect(entries[0][0]).toBe(key(1));
  entries = withOffset(entries, key(1), -2500);
  expect(entries.at(-1)).toEqual([key(1), -2500]);
  expect(withOffset(entries, key(1), 0).some(([other]) => other === key(1))).toBe(false);
});

it('keeps offsets saved by the native plugin and never writes over an unreadable file', async () => {
  const songKey = await cacheKey(song);
  const saved = [
    [key(1), 1200],
    ['not-a-key', 100],
    [key(2), 10_001],
    [key(3), 0],
    [key(1), -300],
    [songKey, 750],
  ];
  put('lyrics-offsets.json', JSON.stringify({ version: 1, entries: saved }));
  const offsets = new LyricsOffsets();
  expect(await offsets.get(song)).toBe(750);
  await offsets.set(song, -400);
  expect(JSON.parse(files.get('lyrics-offsets.json')?.text ?? '')).toEqual({
    version: 1,
    entries: [
      [key(1), -300],
      [songKey, -400],
    ],
  });
  put('lyrics-offsets.json', 'broken');
  expect(await new LyricsOffsets().get(song)).toBe(0);
  expect(files.get('lyrics-offsets.json.bad')?.text).toBe('broken');
});

it('never writes over an offsets file from a newer version', async () => {
  const newer = JSON.stringify({ version: 2, entries: [] });
  put('lyrics-offsets.json', newer);
  const offsets = new LyricsOffsets();
  await expect(offsets.set(song, 500)).rejects.toThrow();
  await expect(offsets.get(song)).rejects.toThrow();
  expect(files.get('lyrics-offsets.json')?.text).toBe(newer);
  expect(files.has('lyrics-offsets.json.bad')).toBe(false);
});

it('rejects a non-integer offset instead of erasing the saved one', async () => {
  const service = await serviceUnderTest();
  const call = { artist: song.artist, title: song.title, album: '', durationMs: song.durationMs };
  await service['lyrics-offset-set']({ ...call, offsetMs: 1500 });
  await expect(async () =>
    service['lyrics-offset-set']({ ...call, offsetMs: 1500.5 }),
  ).rejects.toThrow();
  await expect(async () => service['lyrics-offset-set']({ ...call })).rejects.toThrow();
  expect(await service['lyrics-offset-get'](call)).toBe(1500);
});
