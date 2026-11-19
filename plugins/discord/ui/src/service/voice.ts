import { isRecord } from '@supadashboard/kit';
import { readMember, readSelected, type Channel, type Member, type User } from './model';

export type VoiceState = {
  user?: User;
  channel?: Channel;
  lastChannel?: Channel;
  members: Member[];
  /** `[muted, deafened]`, unknown until Discord reported it. */
  settings?: [boolean, boolean];
};

export const emptyVoice = (lastChannel?: Channel): VoiceState => ({ members: [], lastChannel });

/** Rebuilds from GET_SELECTED_VOICE_CHANNEL; ordering and speaking survive across snapshots. */
export function applySelected(state: VoiceState, data: unknown): VoiceState {
  const { channel, members: incoming } = readSelected(data);
  const previousAccess = state.channel?.access;
  const next: VoiceState = {
    ...state,
    channel:
      channel?.id === state.channel?.id && channel && !channel.access && previousAccess
        ? { ...channel, access: previousAccess }
        : channel,
  };
  let members = state.members;
  if (state.channel?.id !== channel?.id) {
    if (state.channel?.kind === 'guild') {
      next.lastChannel = state.channel;
    }
    members = [];
  }
  members = members.filter((old) => incoming.some((item) => item.id === old.id));
  for (const item of incoming) {
    const index = members.findIndex((old) => old.id === item.id);
    if (index < 0) {
      members.push(item);
    } else {
      members[index] = { ...item, speaking: members[index].speaking };
    }
  }
  next.members = members;
  return next;
}

export function applyEvent(state: VoiceState, event: string, data: unknown): VoiceState {
  if (!isRecord(data) || (event !== 'VOICE_SETTINGS_UPDATE' && !state.channel)) {
    return state;
  }
  // A dispatch for another channel is stale.
  if (typeof data.channel_id === 'string' && state.channel?.id !== data.channel_id) {
    return state;
  }
  switch (event) {
    case 'VOICE_SETTINGS_UPDATE':
      return typeof data.mute === 'boolean' && typeof data.deaf === 'boolean'
        ? { ...state, settings: [data.mute, data.deaf] }
        : state;
    case 'SPEAKING_START':
    case 'SPEAKING_STOP':
      return {
        ...state,
        members: state.members.map((item) =>
          item.id === data.user_id ? { ...item, speaking: event === 'SPEAKING_START' } : item,
        ),
      };
    case 'VOICE_STATE_CREATE':
    case 'VOICE_STATE_UPDATE': {
      const item = readMember(data);
      if (!item) {
        return state;
      }
      const index = state.members.findIndex((old) => old.id === item.id);
      if (index >= 0) {
        const members = [...state.members];
        members[index] = { ...item, speaking: members[index].speaking };
        return { ...state, members };
      }
      return state.members.length < 99 ? { ...state, members: [...state.members, item] } : state;
    }
    case 'VOICE_STATE_DELETE': {
      const id = isRecord(data.user) ? data.user.id : undefined;
      return { ...state, members: state.members.filter((item) => item.id !== id) };
    }
    default:
      return state;
  }
}

export function voiceView(state: VoiceState) {
  if (!state.user) {
    return { state: 'needsAuth' };
  }
  const [muted, deafened] = state.settings ?? [false, false];
  return {
    state: state.channel ? 'inVoice' : 'idle',
    user: state.user,
    muted,
    deafened,
    ...(state.channel ? { channel: state.channel, members: state.members } : {}),
    ...(state.lastChannel ? { lastChannel: state.lastChannel } : {}),
  };
}

const CHANNEL_EVENTS = [
  'VOICE_STATE_CREATE',
  'VOICE_STATE_UPDATE',
  'VOICE_STATE_DELETE',
  'SPEAKING_START',
  'SPEAKING_STOP',
];

export type Subscription = { cmd: 'SUBSCRIBE' | 'UNSUBSCRIBE'; event: string; channelId: string };

export function subscriptions(old?: Channel, next?: Channel): Subscription[] {
  if (old?.id === next?.id) {
    return [];
  }
  return (
    [
      ['UNSUBSCRIBE', old],
      ['SUBSCRIBE', next],
    ] as const
  ).flatMap(([cmd, channel]) =>
    channel ? CHANNEL_EVENTS.map((event) => ({ cmd, event, channelId: channel.id })) : [],
  );
}
