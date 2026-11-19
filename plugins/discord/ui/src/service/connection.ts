// Connecting a Client: handshake, sign-in over the pipe, AUTHENTICATE, and the first state snapshot.
import { isRecord, pluginOAuth } from '@supadashboard/kit';
import type { Client } from './client';
import { readChannelAccess, readUser, type Channel } from './model';
import { PLUGIN, SECRET, needsRefresh, readCredentials, saveLastChannel } from './store';
import { applyEvent } from './voice';

export const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
/** The host swaps this for the access token, so it never reaches the plugin. */
const TOKEN = `{{secret:${SECRET}}}`;

// The host fails a refresh with exactly this text, and signs out, when Discord rejected the refresh token. Any other
// failure (network, 5xx, timeout) keeps the account so the connection retries.
const SIGN_IN_AGAIN = 'Sign in again';
export const refreshRejected = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)) === SIGN_IN_AGAIN;

export async function refresh(client: Client) {
  await pluginOAuth.refresh(PLUGIN, SECRET);
  client.credentials = await readCredentials();
  if (!client.credentials) {
    throw new Error(SIGN_IN_AGAIN);
  }
}

async function authenticate(client: Client) {
  client.setPhase('authenticating');
  const failAuth = (error: unknown) => {
    client.phase = 'needsAuth';
    return error;
  };
  const refreshOrFail = () =>
    refresh(client).catch((error: unknown) => {
      throw refreshRejected(error) ? failAuth(error) : error;
    });
  if (client.credentials && needsRefresh(client.credentials)) {
    await refreshOrFail();
  }
  const send = () => client.request('AUTHENTICATE', { access_token: TOKEN });
  let response: unknown;
  try {
    response = await send();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Discord rejected AUTHENTICATE') {
      throw error;
    }
    await refreshOrFail();
    response = await send().catch((retry: unknown) => {
      throw failAuth(retry);
    });
  }
  const scopes = isRecord(response) && Array.isArray(response.scopes) ? response.scopes : [];
  if (!SCOPES.every((scope) => scopes.includes(scope))) {
    throw failAuth(new Error('Discord voice permission missing'));
  }
  const user = isRecord(response) ? readUser(response.user) : undefined;
  if (!user) {
    throw new Error('Invalid Discord user');
  }
  client.voice = { ...client.voice, user };
}

/** Asks Discord for consent and signs in; the host exchanges the code with the PKCE verifier it kept. */
async function authorize(client: Client, clientId: string) {
  client.setPhase('authorizing');
  const challenge = await pluginOAuth.pkce(PLUGIN, SECRET);
  const response = await client.request('AUTHORIZE', {
    client_id: clientId,
    scopes: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const code = isRecord(response) ? response.code : undefined;
  if (typeof code !== 'string' || !code || code.length > 8192) {
    throw new Error('Invalid Discord authorization');
  }
  await pluginOAuth.exchange(PLUGIN, SECRET, clientId, code);
  client.credentials = await readCredentials();
  if (
    client.voice.lastChannel &&
    client.voice.lastChannel.id !== client.credentials?.lastChannel?.id
  ) {
    await saveLastChannel(client.voice.lastChannel);
  }
}

/** Connects with the saved account, or signs in first with `authorizeClientId`. */
export async function connect(client: Client, authorizeClientId?: string) {
  const clientId = authorizeClientId ?? client.credentials?.clientId;
  if (!clientId) {
    throw new Error('Connect Discord first');
  }
  client.setPhase('handshake');
  await client.openRpc(clientId);
  if (authorizeClientId) {
    await authorize(client, authorizeClientId);
  }
  await authenticate(client);
  for (const event of ['VOICE_CHANNEL_SELECT', 'VOICE_SETTINGS_UPDATE']) {
    await client.rpc?.request('SUBSCRIBE', {}, event);
  }
  const settings = await client.request('GET_VOICE_SETTINGS', {});
  client.voice = applyEvent(client.voice, 'VOICE_SETTINGS_UPDATE', settings);
  if (!client.voice.settings) {
    throw new Error('Invalid Discord voice settings');
  }
  // Speaking state belongs to the old connection; the channel remains for leave/switch detection.
  client.voice = { ...client.voice, members: [] };
  await client.selected();
  client.connected();
}

/** The room's access from the guild listing; undefined when Discord does not say. */
export async function readAccess(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<Channel['access']> {
  try {
    const data = await client.request('GET_CHANNELS', { guild_id: guildId });
    if (isRecord(data) && Array.isArray(data.channels)) {
      const entry = data.channels.find((item) => isRecord(item) && item.id === channelId);
      return readChannelAccess(entry, guildId);
    }
  } catch (error) {
    // The guild listing is optional. Some Discord clients reject it with these voice scopes.
    if (!(error instanceof Error) || error.message !== 'Discord rejected GET_CHANNELS') {
      throw error;
    }
  }
}
