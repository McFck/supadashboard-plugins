import { pluginHttp, type PluginHttpResponse } from '@supadashboard/kit';
import type { LyricsView } from '../lyrics';
import manifest from '../../../plugin.json';
import { normalized, pick, readRecord, type LrclibRecord } from './matching';
import { query, sleep } from './query';
import type { Track } from './track';

const SPACING_MS = 250;
/** A longer server cooldown fails the request instead of holding the tile. */
const MAX_WAIT_MS = 60_000;

function records(body: string, many: boolean) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Invalid lyrics response');
  }
  const read: unknown = many ? parsed : [parsed];
  const result: LrclibRecord[] = [];
  for (const raw of Array.isArray(read) ? read : [null]) {
    const record = readRecord(raw);
    if (!record) {
      throw new Error('Invalid lyrics response');
    }
    result.push(record);
  }
  return result;
}

/** LRCLIB lookups, one at a time with spacing; a 429 cooldown carries over to the next track. */
export class LrclibClient {
  private retryAt = 0;

  private async request(path: string, fields: [string, string][]): Promise<PluginHttpResponse> {
    const url = `https://lrclib.net/api/${path}?${query(fields)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = this.retryAt - Date.now();
      if (wait > MAX_WAIT_MS) {
        throw new Error('Lyrics rate limited');
      }
      if (wait > 0) {
        await sleep(wait);
      }
      await sleep(SPACING_MS);
      const response = await pluginHttp('spotify', {
        method: 'GET',
        url,
        headers: {
          'User-Agent': `SupaDashboard/${manifest.version} (https://github.com/McFck/supadashboard-plugins)`,
        },
      });
      if (response.status !== 429) {
        return response;
      }
      const delay = Number.parseInt(response.retryAfter ?? '', 10);
      this.retryAt = Date.now() + Math.max(1, Number.isNaN(delay) ? 60 : delay) * 1000;
    }
    throw new Error('Lyrics rate limited');
  }

  async fetch(track: Track): Promise<LyricsView> {
    const response = await this.request('get', [
      ['track_name', track.title],
      ['artist_name', track.artist],
      ['album_name', track.album],
      ['duration', String(track.duration)],
    ]);
    // Every candidate is kept, so a plain or farther match never hides a synced one found later.
    const found: LrclibRecord[] = [];
    if (response.status === 200) {
      found.push(...records(response.body, false));
      const view = pick(found, track);
      if (view.kind === 'synced') {
        return view;
      }
    } else if (response.status !== 404) {
      throw new Error('Lyrics unavailable');
    }
    const [title, artist] = normalized(track.title, track.artist);
    const searches: [string, string][][] = [
      [
        ['track_name', title],
        ['artist_name', artist],
      ],
      [['q', `${title} ${artist}`]],
    ];
    for (const fields of searches) {
      const search = await this.request('search', fields);
      if (search.status !== 200) {
        throw new Error('Lyrics unavailable');
      }
      found.push(...records(search.body, true));
      const view = pick(found, track);
      if (view.kind === 'synced') {
        return view;
      }
    }
    return pick(found, track);
  }
}
