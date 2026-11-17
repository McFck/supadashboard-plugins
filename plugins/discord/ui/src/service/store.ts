// The signed-in account: the host keeps the tokens in `plugin-data/discord/discord.json` (secret `discord`, the
// file the native plugin wrote); the plugin reads and writes only the client id and the last guild channel.
import { pluginOAuth, pluginSecrets } from '@supadashboard/kit';
import { isRecord, validChannel, validId, type Channel } from './model';

export const PLUGIN = 'discord';
export const SECRET = 'discord';

export type Credentials = {
  clientId: string;
  lastChannel?: Channel;
  /** Access token expiry, Unix milliseconds. */
  expiresAt: number;
};

function readChannel(raw: unknown): Channel | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    return undefined;
  }
  const channel: Channel = {
    id: raw.id,
    name: raw.name,
    kind: raw.kind === 'guild' ? 'guild' : 'dm',
    ...(typeof raw.guildId === 'string' ? { guildId: raw.guildId } : {}),
  };
  return raw.kind === 'guild' && validChannel(channel) ? channel : undefined;
}

/** `null` when signed out; throws when the record cannot be read (it is then left untouched). */
export async function readCredentials(): Promise<Credentials | null> {
  const { fields, signedIn, expiresAt } = await pluginSecrets.read(PLUGIN, SECRET);
  if (!signedIn || !validId(fields.clientId) || expiresAt === null) {
    return null;
  }
  return { clientId: fields.clientId, lastChannel: readChannel(fields.lastChannel), expiresAt };
}

export const saveLastChannel = (channel: Channel | undefined) =>
  pluginSecrets.write(PLUGIN, SECRET, { lastChannel: channel ?? null });

/** Drops the tokens, then the rest of the record so the file goes away. */
export async function signOut() {
  await pluginOAuth.signOut(PLUGIN, SECRET);
  await pluginSecrets.write(PLUGIN, SECRET, { clientId: null, lastChannel: null });
}

/** Refresh a minute before the token expires. */
export const needsRefresh = (credentials: Credentials) =>
  credentials.expiresAt <= Date.now() + 60_000;
