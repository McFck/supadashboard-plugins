import { expect, it } from 'vitest';
import { applyEvent, applySelected, emptyVoice, subscriptions } from './voice';

// GET_SELECTED_VOICE_CHANNEL structure with synthetic ids and names.
const channel = (id: string): Record<string, any> => ({
  id,
  name: 'Voice',
  type: 2,
  guild_id: '323456789012345678',
  voice_states: [
    {
      nick: ' Alice ',
      mute: false,
      voice_state: { mute: false, deaf: false, self_mute: true, self_deaf: false, suppress: false },
      user: {
        id: '123456789012345678',
        username: 'alice',
        discriminator: '0',
        global_name: null,
        avatar: 'a_0123456789abcdef0123456789abcdef',
      },
    },
  ],
});

it('keeps members, speaking state and subscriptions right across join, leave and switch', () => {
  let state = applySelected(emptyVoice(), channel('223456789012345678'));
  expect(state.members[0]).toMatchObject({ name: 'Alice', muted: true });
  expect(subscriptions(undefined, state.channel)).toHaveLength(5);
  const newcomer = structuredClone(channel('223456789012345678').voice_states[0]);
  newcomer.user.id = '423456789012345678';
  state = applyEvent(state, 'VOICE_STATE_CREATE', newcomer);
  expect(state.members).toHaveLength(2);
  const speaking = { user_id: '423456789012345678' };
  state = applyEvent(state, 'SPEAKING_START', speaking);
  expect(state.members[1].speaking).toBe(true);
  state = applyEvent(state, 'SPEAKING_STOP', speaking);
  expect(state.members[1].speaking).toBe(false);
  const switched = applySelected(state, channel('523456789012345678'));
  const commands = subscriptions(state.channel, switched.channel);
  expect(commands).toHaveLength(10);
  expect(
    commands
      .slice(0, 5)
      .every((c) => c.cmd === 'UNSUBSCRIBE' && c.channelId === '223456789012345678'),
  ).toBe(true);
  const left = applySelected(switched, null);
  expect(left.channel).toBeUndefined();
  expect(left.members).toEqual([]);
  expect(left.lastChannel?.id).toBe('523456789012345678');
});

it('drops invalid members and avatar hashes before they reach the view', () => {
  const raw = channel('223456789012345678');
  raw.voice_states[0].user.avatar = '../../bad';
  const state = applySelected(emptyVoice(), raw);
  expect(state.members[0].avatar).toBeNull();
  raw.voice_states[0].user.id = 'invalid';
  expect(applySelected(state, raw).members).toEqual([]);
  raw.voice_states[0].user.id = '123456789012345678';
  raw.voice_states[0].voice_state.mute = 'invalid';
  expect(applySelected(state, raw).members).toEqual([]);
  raw.id = 'invalid';
  expect(() => applySelected(state, raw)).toThrow();
});

it('ignores events of other channels and keeps the guild channel for rejoin after a DM call', () => {
  let state = applySelected(emptyVoice(), channel('223456789012345678'));
  state = applyEvent(state, 'SPEAKING_START', {
    channel_id: '999456789012345678',
    user_id: '123456789012345678',
  });
  expect(state.members[0].speaking).toBe(false);
  const dm = { ...channel('523456789012345678'), type: 1, guild_id: null, name: null };
  state = applySelected(applySelected(state, dm), null);
  expect(state.lastChannel?.id).toBe('223456789012345678');
});
