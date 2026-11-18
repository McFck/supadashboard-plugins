import { expect, it } from 'vitest';
import { avatarUrl, readVoiceView } from './discord';

const id = '123456789012345678';
const hash = '0123456789abcdef0123456789abcdef';
const member = {
  id,
  name: 'Member',
  avatar: hash,
  discriminator: '0',
  speaking: false,
  muted: false,
  deafened: false,
};
const channel = { id, name: 'Voice', kind: 'guild' };
const snapshot = {
  state: 'inVoice',
  user: { id, name: 'Owner' },
  muted: false,
  deafened: true,
  channel,
  members: [member],
};
it('rejects malformed or oversized native state before it reaches controls', () => {
  for (const raw of [
    null,
    [],
    { state: 'unknown' },
    { ...snapshot, muted: 1 },
    { ...snapshot, user: { id: 'invalid', name: 'Owner' } },
    { ...snapshot, user: { id, name: 'x'.repeat(65) } },
    { ...snapshot, channel: { ...channel, guildId: '../guild' } },
    { ...snapshot, channel: { ...channel, kind: 'text' } },
    { ...snapshot, channel: { ...channel, access: 'unknown' } },
    { ...snapshot, lastChannel: { ...channel, kind: 'dm' } },
    { ...snapshot, members: Array(100).fill(member) },
    { ...snapshot, members: [member, member] },
    ...[
      { id: '../avatar' },
      { avatar: 'https://evil.example/avatar.png' },
      { discriminator: '1e3' },
      { name: 'bad\nname' },
      { speaking: 'true' },
    ].map((patch) => ({ ...snapshot, members: [{ ...member, ...patch }] })),
  ]) {
    expect(readVoiceView(raw), JSON.stringify(raw)).toBeUndefined();
  }
  expect(readVoiceView(snapshot)).toEqual(snapshot);
  expect(
    readVoiceView({ ...snapshot, channel: { ...channel, access: 'restricted' } }),
  ).toMatchObject({ channel: { ...channel, access: 'restricted' } });
  expect(readVoiceView({ ...snapshot, lastChannel: channel })).toMatchObject({
    lastChannel: channel,
  });
  expect(readVoiceView({ ...snapshot, channel: { ...channel, kind: 'dm' } })).toBeDefined();
  expect(readVoiceView({ ...snapshot, state: 'idle' })).toEqual({
    state: 'idle',
    user: snapshot.user,
    muted: false,
    deafened: true,
  });
  for (const state of ['absent', 'needsAuth', 'authorizing', 'connecting']) {
    expect(readVoiceView({ state, ignored: 'extra' })).toEqual({ state });
  }
  const members = Array.from({ length: 99 }, (_, index) => ({
    ...member,
    id: String(BigInt(id) + BigInt(index)),
  }));
  expect(readVoiceView({ ...snapshot, members })).toMatchObject({ members });
});

it('builds only Discord CDN URLs from valid ids, hashes and default-avatar indices', () => {
  for (const [patch, expected] of [
    [{}, `avatars/${id}/${hash}.png?size=128`],
    [{ avatar: `a_${hash}` }, `avatars/${id}/a_${hash}.png?size=128`],
    [{ avatar: null }, 'embed/avatars/0.png'],
    [{ avatar: null, id: '123456789016539982' }, 'embed/avatars/1.png'],
    [{ avatar: null, discriminator: '1234' }, 'embed/avatars/4.png'],
    [{ avatar: null, discriminator: '9999' }, 'embed/avatars/4.png'],
    [{ id: '../123' }, undefined],
    [{ avatar: '../avatar' }, undefined],
    [{ avatar: hash.toUpperCase() }, undefined],
    [{ discriminator: '12345' }, undefined],
  ] as const) {
    expect(avatarUrl({ ...member, ...patch })).toBe(
      expected === undefined ? undefined : `https://cdn.discordapp.com/${expected}`,
    );
  }
});
