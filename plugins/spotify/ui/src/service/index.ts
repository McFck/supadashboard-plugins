import { isRecord, providePlugin, type PluginService } from '@supadashboard/kit';
import { validClientId } from './api';
import { SpotifyClient, type LikeOp, type ShuffleMode } from './client';
import { LyricsHub } from './lyrics-hub';
import { LyricsOffsets } from './offsets';
import { readTrack } from './track';

const LIKE_OPS: unknown[] = ['like', 'unlike', 'dislike'];
const SHUFFLE_MODES: unknown[] = ['on', 'off', 'toggle'];

function track(params: unknown) {
  const read = readTrack(params);
  if (!read) {
    throw new Error('Invalid lyrics track');
  }
  return read;
}

/**
 * The Spotify service of the dashboard owner: the Web API client runs while some window is subscribed, and the
 * lyrics and their offsets answer any call. Unsubscribes are counted, not attributed: the shared realm gives no
 * window identity.
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
      if (!LIKE_OPS.includes(op)) {
        throw new Error('Unknown Spotify command');
      }
      return running().operation({ kind: 'command', op: op as LikeOp });
    },
    shuffle(params) {
      const mode = isRecord(params) ? params.mode : undefined;
      if (!SHUFFLE_MODES.includes(mode)) {
        throw new Error('Unknown shuffle mode');
      }
      return running().operation({ kind: 'shuffle', mode: mode as ShuffleMode });
    },
    'lyrics-get': (params) => lyrics.get(track(params).track),
    'lyrics-offset-get': (params) => offsets.get(track(params).track),
    'lyrics-offset-set'(params) {
      const { track: read, offsetMs } = track(params);
      return offsets.set(read, offsetMs);
    },
  };
  const dispose = providePlugin('spotify', service);
  return () => {
    dispose();
    client?.stop();
  };
}
