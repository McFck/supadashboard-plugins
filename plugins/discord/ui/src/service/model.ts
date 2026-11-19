// Discord RPC payloads reduced to the views the dashboard shows. Everything from the pipe is validated here.
import { isRecord } from '@supadashboard/kit';

export type Channel = {
  id: string;
  name: string;
  kind: 'guild' | 'dm';
  guildId?: string;
  access?: 'open' | 'restricted';
};
export type User = { id: string; name: string };
export type Member = User & {
  avatar: string | null;
  discriminator: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
};

export const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
export const validAvatar = (hash: unknown): hash is string =>
  typeof hash === 'string' && /^(a_)?[0-9a-f]{32}$/.test(hash);
export const validDiscriminator = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{1,4}$/.test(value);

const optionalString = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === 'string';

function cleanName(value: string) {
  return [...value.trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, '')].slice(0, 64).join('');
}

export function validChannel(channel: Channel) {
  return (
    validId(channel.id) &&
    channel.name !== '' &&
    channel.name === cleanName(channel.name) &&
    (channel.kind === 'guild' || channel.kind === 'dm') &&
    (channel.guildId === undefined || validId(channel.guildId))
  );
}

type RpcUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator: string;
};

function readRpcUser(raw: unknown): RpcUser | undefined {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.username !== 'string' ||
    typeof raw.discriminator !== 'string' ||
    !optionalString(raw.global_name) ||
    !optionalString(raw.avatar)
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    username: raw.username,
    global_name: raw.global_name,
    avatar: raw.avatar,
    discriminator: raw.discriminator,
  };
}

function userView(user: RpcUser): User | undefined {
  const name = cleanName(user.global_name?.trim() ? user.global_name : user.username);
  return validId(user.id) && name ? { id: user.id, name } : undefined;
}

export function readUser(raw: unknown): User | undefined {
  const user = readRpcUser(raw);
  return user && userView(user);
}

const flags = ['mute', 'deaf', 'self_mute', 'self_deaf', 'suppress'] as const;

export function readMember(data: unknown): Member | undefined {
  if (!isRecord(data) || !isRecord(data.voice_state) || typeof data.mute !== 'boolean') {
    return undefined;
  }
  const voice = data.voice_state;
  const user = readRpcUser(data.user);
  const view = user && userView(user);
  if (
    !user ||
    !view ||
    !optionalString(data.nick) ||
    !flags.every((flag) => typeof voice[flag] === 'boolean') ||
    !validDiscriminator(user.discriminator)
  ) {
    return undefined;
  }
  const nick = cleanName(typeof data.nick === 'string' ? data.nick : '');
  return {
    id: view.id,
    name: nick || view.name,
    avatar: user.avatar && validAvatar(user.avatar) ? user.avatar : null,
    discriminator: user.discriminator,
    speaking: false,
    muted: data.mute || voice.mute === true || voice.self_mute === true || voice.suppress === true,
    deafened: voice.deaf === true || voice.self_deaf === true,
  };
}

function channelKind(type: number) {
  if (type === 2 || type === 13) {
    return 'guild';
  }
  return type === 1 || type === 3 ? 'dm' : undefined;
}

const VOICE_ACCESS = (1n << 10n) | (1n << 20n); // VIEW_CHANNEL and CONNECT.

function permissionBits(raw: unknown) {
  if (typeof raw === 'string' && /^\d{1,20}$/.test(raw)) {
    return BigInt(raw);
  }
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return BigInt(raw);
  }
}

/** The room's @everyone overwrite if Discord supplies it, otherwise the user's effective access if available. */
export function readChannelAccess(raw: unknown, guildId?: string): Channel['access'] {
  if (!isRecord(raw)) {
    return undefined;
  }
  const permissions = permissionBits(raw.permissions);
  if (permissions !== undefined && (permissions & VOICE_ACCESS) !== VOICE_ACCESS) {
    return 'restricted';
  }
  if (guildId && Array.isArray(raw.permission_overwrites)) {
    const everyone = raw.permission_overwrites.find(
      (item) => isRecord(item) && item.id === guildId && (item.type === 0 || item.type === 'role'),
    );
    if (isRecord(everyone)) {
      const denied = permissionBits(everyone.deny);
      if (denied !== undefined) {
        return (denied & VOICE_ACCESS) !== 0n ? 'restricted' : 'open';
      }
    } else if (raw.permission_overwrites.every(isRecord)) {
      return 'open';
    }
  }
  if (permissions !== undefined) {
    return 'open';
  }
}

/** A GET_SELECTED_VOICE_CHANNEL reply: `null` when out of voice; throws on a malformed channel. */
export function readSelected(data: unknown): { channel?: Channel; members: Member[] } {
  if (data === null || data === undefined) {
    return { members: [] };
  }
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    typeof data.type !== 'number' ||
    !optionalString(data.name) ||
    !optionalString(data.guild_id) ||
    !Array.isArray(data.voice_states)
  ) {
    throw new Error('Invalid Discord channel');
  }
  const kind = channelKind(data.type);
  if (!kind) {
    throw new Error('Invalid Discord channel type');
  }
  const fallback = kind === 'dm' ? 'Voice call' : '';
  const guildId = typeof data.guild_id === 'string' ? data.guild_id : undefined;
  const access = kind === 'guild' ? readChannelAccess(data, guildId) : undefined;
  const channel: Channel = {
    id: data.id,
    name: cleanName(typeof data.name === 'string' && data.name.trim() ? data.name : fallback),
    kind,
    ...(guildId === undefined ? {} : { guildId }),
    ...(access === undefined ? {} : { access }),
  };
  if (!validChannel(channel)) {
    throw new Error('Invalid Discord channel');
  }
  const members = data.voice_states.map(readMember).filter((member) => member !== undefined);
  return { channel, members: members.slice(0, 99) };
}
