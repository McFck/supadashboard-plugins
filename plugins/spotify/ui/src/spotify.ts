import { invoke, isTauri } from '@tauri-apps/api/core';
import { callPlugin, pluginStateHub, isRecord, ActionFailure } from '@supadashboard/kit';
import { errorTitle, validClientId, validText, validUri } from './service/api';

export type SpotifyView =
  | { state: 'needsAuth' | 'connecting'; error?: string }
  | {
      state: 'ready';
      user: string;
      trackUri: string | null;
      liked: boolean | null;
      smartShuffle: boolean;
      shuffle?: boolean;
      error?: string;
    };
type SpotifyCommand = 'like' | 'unlike' | 'dislike';
const shownText = (text: unknown): text is string =>
  typeof text === 'string' && text.trim().length > 0 && validText(text, 512);

export function readSpotifyView(raw: unknown): SpotifyView | undefined {
  if (!isRecord(raw) || (raw.error != null && !shownText(raw.error))) {
    return undefined;
  }
  const error = typeof raw.error === 'string' ? { error: raw.error } : {};
  if (raw.state === 'needsAuth' || raw.state === 'connecting') {
    return { state: raw.state, ...error };
  }
  if (
    raw.state !== 'ready' ||
    !shownText(raw.user) ||
    (raw.trackUri !== null && (typeof raw.trackUri !== 'string' || !validUri(raw.trackUri))) ||
    (raw.liked !== null && typeof raw.liked !== 'boolean') ||
    typeof raw.smartShuffle !== 'boolean' ||
    (raw.shuffle !== undefined && typeof raw.shuffle !== 'boolean') ||
    (raw.trackUri === null && raw.liked !== null)
  ) {
    return undefined;
  }
  return {
    state: 'ready',
    user: raw.user,
    trackUri: raw.trackUri,
    liked: raw.liked,
    smartShuffle: raw.smartShuffle,
    ...(typeof raw.shuffle === 'boolean' ? { shuffle: raw.shuffle } : {}),
    ...error,
  };
}

const hub = pluginStateHub<SpotifyView>(
  'spotify',
  (raw) => readSpotifyView(raw) ?? { state: 'needsAuth', error: 'Invalid Spotify state' },
  { state: 'needsAuth' },
  { state: 'needsAuth', error: 'Spotify unavailable' },
);

export const subscribeSpotify = hub.subscribe;

async function command(method: string, params?: Record<string, unknown>) {
  if (!isTauri()) {
    throw new Error('Spotify unavailable');
  }
  if (!(await hub.settled()).subscribed) {
    throw new Error('Connect Spotify first');
  }
  await callPlugin('spotify', method, params);
}

export async function spotifyAuthorize(clientId: string) {
  const id = clientId.trim();
  if (!validClientId(id)) {
    throw new Error('Invalid Spotify client ID');
  }
  await command('authorize', { clientId: id });
}

export const spotifyLogout = () => command('logout');
export const spotifyCommand = (op: SpotifyCommand) => command('command', { op });

export async function spotifyTransport(command: string) {
  if (!/^(shuffle:(on|off|toggle)|repeat:(off|context|track|cycle))$/.test(command)) {
    throw new Error('Invalid Spotify command');
  }
  if (!isTauri()) {
    throw new Error('Spotify unavailable');
  }
  if (command.startsWith('shuffle:')) {
    try {
      await callPlugin('spotify', 'shuffle', { mode: command.slice('shuffle:'.length) });
    } catch (error) {
      throw new ActionFailure(errorTitle(error, 'Spotify shuffle failed'));
    }
    return;
  }
  const sent = await invoke<boolean>('media_command', { target: 'spotify', command });
  if (!sent) {
    throw new Error("Spotify isn't playing");
  }
}
