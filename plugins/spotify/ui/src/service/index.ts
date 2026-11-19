import { isRecord, providePlugin, type PluginService } from '@supadashboard/kit';
import { validClientId } from './api';
import { SpotifyClient, type LikeOp, type ShuffleMode } from './client';
import { LyricsHub } from './lyrics-hub';
import { LyricsOffsets } from './offsets';
import { readTrack } from './track';

const LIKE_OPS: readonly LikeOp[] = ['like', 'unlike', 'dislike'];
const SHUFFLE_MODES: readonly ShuffleMode[] = ['on', 'off', 'toggle'];

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  values.some((known) => known === value);

function track(params: unknown) {
  const read = readTrack(params);
  if (!read) {
    throw new Error('Invalid lyrics track');
  }
  return read;
}

/**
 * The Web API client runs while some window is subscribed; lyrics and offsets answer any call. Subscriptions are
 * counted, not attributed, because the shared realm gives no window identity.
 */
export function provideSpotify(): () => void {
  const lyrics = new LyricsHub();
  const offsets = new LyricsOffsets();
  let client: SpotifyClient | undefined;
  let subscribers = 0;
  const running = () => {
    if (!client) {
      throw new Error('Connect Spotify first');
    }
    return client;
  };
  const service: PluginService = {
    subscribe() {
      subscribers += 1;
      if (!client) {
        client = new SpotifyClient();
        client.start();
      }
      return client.snapshot();
    },
    unsubscribe() {
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers === 0) {
        client?.stop();
        client = undefined;
      }
    },
    authorize(params) {
      const id =
        isRecord(params) && typeof params.clientId === 'string' ? params.clientId.trim() : '';
      if (!validClientId(id)) {
        throw new Error('Invalid Spotify client ID');
      }
      return running().operation({ kind: 'authorize', clientId: id });
    },
    logout: () => running().operation({ kind: 'logout' }),
    command(params) {
      const op = isRecord(params) ? params.op : undefined;
      if (!isOneOf(LIKE_OPS, op)) {
        throw new Error('Unknown Spotify command');
      }
      return running().operation({ kind: 'command', op });
    },
    shuffle(params) {
      const mode = isRecord(params) ? params.mode : undefined;
      if (!isOneOf(SHUFFLE_MODES, mode)) {
        throw new Error('Unknown shuffle mode');
      }
      return running().operation({ kind: 'shuffle', mode });
    },
    'lyrics-get': (params) => lyrics.get(track(params)),
    'lyrics-offset-get': (params) => offsets.get(track(params)),
    'lyrics-offset-set'(params) {
      const offsetMs = isRecord(params) ? params.offsetMs : undefined;
      if (typeof offsetMs !== 'number') {
        throw new Error('Invalid lyrics offset');
      }
      return offsets.set(track(params), offsetMs);
    },
  };
  const dispose = providePlugin('spotify', service);
  return () => {
    dispose();
    client?.stop();
  };
}
