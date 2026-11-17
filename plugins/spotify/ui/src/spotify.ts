import { invoke, isTauri } from '@tauri-apps/api/core';
import { callPlugin, pluginStateHub, isRecord, ActionFailure } from '@supadashboard/kit';

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
const validId = (id: string) => /^[a-fA-F0-9]{32}$/.test(id);
const validText = (text: unknown): text is string =>
  typeof text === 'string' &&
  text.trim().length > 0 &&
  text.length <= 512 &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(text);

export function readSpotifyView(raw: unknown): SpotifyView | undefined {
  if (!isRecord(raw) || (raw.error != null && !validText(raw.error))) {
    return undefined;
  }
  const error = typeof raw.error === 'string' ? { error: raw.error } : {};
  if (raw.state === 'needsAuth' || raw.state === 'connecting') {
    return { state: raw.state, ...error };
  }
  if (
    raw.state !== 'ready' ||
    !validText(raw.user) ||
    (raw.trackUri !== null &&
      (typeof raw.trackUri !== 'string' ||
        !/^spotify:track:[a-zA-Z0-9]{22}$/.test(raw.trackUri))) ||
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
  if (!validId(id)) {
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
      const reason = error instanceof Error ? error.message : error;
      const title =
        typeof reason === 'string' && reason.length <= 80 && validText(reason)
          ? reason
          : 'Spotify shuffle failed';
      throw new ActionFailure(title);
    }
    return;
  }
  const sent = await invoke<boolean>('media_command', { target: 'spotify', command });
  if (!sent) {
    throw new Error("Spotify isn't playing");
  }
}
