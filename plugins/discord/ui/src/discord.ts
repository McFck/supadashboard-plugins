import { isTauri } from '@tauri-apps/api/core';
import { callPlugin, pluginStateHub, isRecord } from '@supadashboard/kit';

type VoiceUser = { id: string; name: string };
type VoiceChannel = VoiceUser & { kind: 'guild' | 'dm'; guildId?: string };
export type VoiceMember = VoiceUser & {
  avatar: string | null;
  discriminator: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
};
type Connected = {
  user: VoiceUser;
  muted: boolean;
  deafened: boolean;
  lastChannel?: VoiceChannel;
};
export type VoiceView =
  | { state: 'absent' | 'needsAuth' | 'authorizing' | 'connecting' }
  | (Connected & { state: 'idle' })
  | (Connected & { state: 'inVoice'; channel: VoiceChannel; members: VoiceMember[] });
type VoiceCommand = 'toggleMute' | 'toggleDeaf' | 'leave' | 'rejoin';

const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
const validAvatar = (hash: unknown): hash is string =>
  typeof hash === 'string' && /^(a_)?[0-9a-f]{32}$/.test(hash);
const validDiscriminator = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{1,4}$/.test(value);

function readUser(raw: unknown): VoiceUser | undefined {
  if (
    !isRecord(raw) ||
    !validId(raw.id) ||
    typeof raw.name !== 'string' ||
    !raw.name.length ||
    raw.name.length > 128 ||
    [...raw.name].length > 64 ||
    raw.name.trim() !== raw.name ||
    /[\u0000-\u001f\u007f-\u009f]/.test(raw.name)
  ) {
    return undefined;
  }
  return { id: raw.id, name: raw.name };
}

function readChannel(raw: unknown): VoiceChannel | undefined {
  const user = readUser(raw);
  if (
    !user ||
    !isRecord(raw) ||
    (raw.kind !== 'guild' && raw.kind !== 'dm') ||
    (raw.guildId !== undefined && !validId(raw.guildId))
  ) {
    return undefined;
  }
  return {
    ...user,
    kind: raw.kind,
    ...(raw.guildId === undefined ? {} : { guildId: raw.guildId }),
  };
}

function readMember(raw: unknown): VoiceMember | undefined {
  const user = readUser(raw);
  if (
    !user ||
    !isRecord(raw) ||
    (raw.avatar !== null && typeof raw.avatar !== 'string') ||
    !validDiscriminator(raw.discriminator) ||
    typeof raw.speaking !== 'boolean' ||
    typeof raw.muted !== 'boolean' ||
    typeof raw.deafened !== 'boolean'
  ) {
    return undefined;
  }
  const member: VoiceMember = {
    ...user,
    avatar: raw.avatar,
    discriminator: raw.discriminator,
    speaking: raw.speaking,
    muted: raw.muted,
    deafened: raw.deafened,
  };
  return avatarUrl(member) ? member : undefined;
}

/** Unknown fields are discarded; malformed snapshots never become live state. */
export function readVoiceView(raw: unknown): VoiceView | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const state = raw.state;
  if (
    state === 'absent' ||
    state === 'needsAuth' ||
    state === 'authorizing' ||
    state === 'connecting'
  ) {
    return { state };
  }
  const user = readUser(raw.user);
  const lastChannel = raw.lastChannel === undefined ? undefined : readChannel(raw.lastChannel);
  if (
    !user ||
    typeof raw.muted !== 'boolean' ||
    typeof raw.deafened !== 'boolean' ||
    (raw.lastChannel !== undefined && lastChannel?.kind !== 'guild')
  ) {
    return undefined;
  }
  const connected: Connected = {
    user,
    muted: raw.muted,
    deafened: raw.deafened,
    ...(lastChannel ? { lastChannel } : {}),
  };
  if (state === 'idle') {
    return { state, ...connected };
  }
  const channel = readChannel(raw.channel);
  if (state !== 'inVoice' || !channel || !Array.isArray(raw.members) || raw.members.length > 99) {
    return undefined;
  }
  const members = raw.members.map(readMember);
  if (members.some((member) => member === undefined)) {
    return undefined;
  }
  const valid = members.filter((member) => member !== undefined);
  if (new Set(valid.map((member) => member.id)).size !== valid.length) {
    return undefined;
  }
  return { state, ...connected, channel, members: valid };
}

/** Passing a null avatar also supplies the image-error fallback for a validated member. */
export function avatarUrl(
  member: Pick<VoiceMember, 'id' | 'avatar' | 'discriminator'>,
): string | undefined {
  if (!validId(member.id) || !validDiscriminator(member.discriminator)) {
    return undefined;
  }
  if (member.avatar !== null) {
    return validAvatar(member.avatar)
      ? `https://cdn.discordapp.com/avatars/${member.id}/${member.avatar}.png?size=128`
      : undefined;
  }
  const index =
    member.discriminator === '0'
      ? Number((BigInt(member.id) >> 22n) % 6n)
      : Number(member.discriminator) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

const hub = pluginStateHub<VoiceView>(
  'discord',
  (raw) => readVoiceView(raw) ?? { state: 'needsAuth' },
  { state: 'absent' },
  { state: 'absent' },
);

export const subscribeVoice = hub.subscribe;

async function command(method: string, params?: Record<string, unknown>) {
  if (!isTauri()) {
    throw new Error("Discord isn't running");
  }
  if (!(await hub.settled()).subscribed) {
    throw new Error('Connect Discord first');
  }
  await callPlugin('discord', method, params);
}

export async function authorize(clientId: string) {
  const id = clientId.trim();
  if (!validId(id)) {
    throw new Error('Invalid Discord client ID');
  }
  await command('authorize', { clientId: id });
}

export const logout = () => command('logout');

export async function voiceCommand(voice: VoiceCommand) {
  const { latest } = await hub.settled();
  if (latest.state === 'absent') {
    throw new Error("Discord isn't running");
  }
  if (latest.state !== 'idle' && latest.state !== 'inVoice') {
    throw new Error('Connect Discord first');
  }
  // Leaving while out of voice already meets the action's goal.
  if (voice === 'leave' && latest.state !== 'inVoice') {
    return;
  }
  if (voice === 'rejoin' && !latest.lastChannel) {
    throw new Error('No channel to rejoin');
  }
  await command('voice', { command: voice });
}
