import type { PluginHttpResponse } from '@supadashboard/kit';
import { isRecord } from '@supadashboard/kit';

export type ApiFailure = 'unauthorized' | 'premium' | 'noPlayer' | 'rateLimited' | 'failed';

const MESSAGES: Record<ApiFailure, string> = {
  unauthorized: 'Connect Spotify first',
  premium: 'Spotify Premium required',
  noPlayer: "Spotify isn't playing",
  rateLimited: 'Spotify rate limited',
  failed: 'Spotify request failed',
};

/** A Web API failure; `message` is the short title the user sees and `retryAfter` is in seconds. */
export class ApiError extends Error {
  constructor(
    readonly failure: ApiFailure,
    readonly retryAfter = 0,
  ) {
    super(MESSAGES[failure]);
  }
}

function premiumRequired(body: string) {
  try {
    const error: unknown = (JSON.parse(body) as { error?: unknown })?.error;
    return (
      isRecord(error) &&
      (error.reason === 'PREMIUM_REQUIRED' || error.message === 'Premium required')
    );
  } catch {
    return false;
  }
}

/** Throws the failure a response stands for; a 2xx passes. */
export function check(response: PluginHttpResponse) {
  const { status } = response;
  if (status >= 200 && status <= 299) {
    return;
  }
  if (status === 401) {
    throw new ApiError('unauthorized');
  }
  if (status === 403 && premiumRequired(response.body)) {
    throw new ApiError('premium');
  }
  if (status === 404) {
    throw new ApiError('noPlayer');
  }
  if (status === 429) {
    const seconds = Number.parseInt(response.retryAfter ?? '', 10);
    throw new ApiError('rateLimited', Math.max(1, Number.isNaN(seconds) ? 30 : seconds));
  }
  throw new ApiError('failed');
}

export const validUri = (uri: string) => /^spotify:track:[a-zA-Z0-9]{22}$/.test(uri);
export const validClientId = (id: string) => /^[0-9a-fA-F]{32}$/.test(id);
/** A name or id that fits the UI: bounded and without control characters. */
export const validText = (text: string, max: number) => text.length <= max && !/\p{Cc}/u.test(text);

export interface Player {
  uri: string | null;
  playing: boolean;
  smartShuffle: boolean;
  shuffle: boolean;
  deviceId: string | null;
}

export const NO_PLAYER: Player = {
  uri: null,
  playing: false,
  smartShuffle: false,
  shuffle: false,
  deviceId: null,
};

function json(body: string, failure: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Reported below.
  }
  throw new Error(failure);
}

/** A boolean that may be absent (then `fallback`) but never another type. */
function flag(value: unknown, fallback: boolean, failure: string) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(failure);
  }
  return value;
}

export function player(body: string): Player {
  const response = json(body, 'Invalid Spotify player');
  const { item, device } = response;
  if (
    typeof response.is_playing !== 'boolean' ||
    (item != null && !isRecord(item)) ||
    (device != null && !isRecord(device))
  ) {
    throw new Error('Invalid Spotify player');
  }
  let uri: string | null = null;
  if (item) {
    if (typeof item.uri !== 'string' || typeof item.type !== 'string') {
      throw new Error('Invalid Spotify player');
    }
    if (item.type === 'track') {
      if (!validUri(item.uri)) {
        throw new Error('Invalid Spotify track');
      }
      uri = item.uri;
    }
  }
  const id = device?.id ?? null;
  if (id !== null && (typeof id !== 'string' || !id || !validText(id, 512))) {
    throw new Error('Invalid Spotify device');
  }
  return {
    uri,
    playing: response.is_playing,
    smartShuffle: flag(response.smart_shuffle, false, 'Invalid Spotify player'),
    shuffle: flag(response.shuffle_state, false, 'Invalid Spotify player'),
    deviceId: id,
  };
}

export function contains(body: string) {
  let values: unknown;
  try {
    values = JSON.parse(body);
  } catch {
    values = null;
  }
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'boolean') {
    throw new Error('Invalid Spotify library response');
  }
  return values[0];
}

/** Whether shuffle is on; Smart shuffle counts as on. */
export function shuffle(body: string) {
  const playback = json(body, 'Invalid Spotify shuffle');
  if (typeof playback.shuffle_state !== 'boolean') {
    throw new Error('Invalid Spotify shuffle');
  }
  const smart = flag(playback.smart_shuffle, false, 'Invalid Spotify shuffle');
  return playback.shuffle_state || smart;
}

export function user(body: string) {
  const profile = json(body, 'Invalid Spotify profile');
  const { id, display_name: displayName } = profile;
  if (typeof id !== 'string' || (displayName != null && typeof displayName !== 'string')) {
    throw new Error('Invalid Spotify profile');
  }
  const name = displayName?.trim() ? displayName : id;
  if (!name.trim() || !validText(name, 512)) {
    throw new Error('Invalid Spotify profile');
  }
  return name;
}
