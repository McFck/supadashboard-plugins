// Discord RPC payloads reduced to the views the dashboard shows. Everything from the pipe is validated here.
export type Channel = { id: string; name: string; kind: 'guild' | 'dm'; guildId?: string };
export type User = { id: string; name: string };
export type Member = User & {
  avatar: string | null;
  discriminator: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
};

type Json = Record<string, unknown>;
export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9]{17,20}$/.test(id);

const optionalString = (value: unknown) =>
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
  return raw as RpcUser;
}

function userView(user: RpcUser): User | undefined {
  const name = cleanName(user.global_name?.trim() ? user.global_name : user.username);
  return validId(user.id) && name ? { id: user.id, name } : undefined;
}

export function readUser(raw: unknown): User | undefined {
  const user = readRpcUser(raw);
  return user && userView(user);
}

const validAvatar = (hash: string) => /^(a_)?[0-9a-f]{32}$/.test(hash);
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
    !/^[0-9]{1,4}$/.test(user.discriminator)
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
  const channel: Channel = {
    id: data.id,
    name: cleanName(typeof data.name === 'string' && data.name.trim() ? data.name : fallback),
    kind,
    ...(typeof data.guild_id === 'string' ? { guildId: data.guild_id } : {}),
  };
  if (!validChannel(channel)) {
    throw new Error('Invalid Discord channel');
  }
  const members = data.voice_states.map(readMember).filter((member) => member !== undefined);
  return { channel, members: members.slice(0, 99) };
}
