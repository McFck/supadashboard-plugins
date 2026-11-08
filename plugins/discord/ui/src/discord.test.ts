import { afterEach, expect, it, vi } from 'vitest';
import { avatarUrl, readVoiceView, subscribeVoice, type VoiceView } from './discord';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: {} as Record<string, (event: { payload: unknown }) => void>,
  unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => native.invoke(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    native.handlers[event] = handler;
    return native.unlisten;
  },
}));

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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => vi.clearAllMocks());

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

it('shares the native worker and keeps newer events over a delayed subscribe reply', async () => {
  let resolve: ((value: unknown) => void) | undefined;
  native.invoke.mockImplementation((command: string, args?: { method?: string }) =>
    command === 'plugin_call' && args?.method === 'subscribe'
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve(),
  );
  const first: VoiceView[] = [];
  const second: VoiceView[] = [];
  const stopFirst = subscribeVoice((view) => first.push(view));
  const stopSecond = subscribeVoice((view) => second.push(view));
  await flush();
  native.handlers['plugin://discord/state']?.({ payload: snapshot });
  resolve?.({ state: 'needsAuth' });
  await flush();
  expect(first.at(-1)).toEqual(snapshot);
  expect(second.at(-1)).toEqual(snapshot);
  const subscribes = native.invoke.mock.calls.filter(([, args]) => args?.method === 'subscribe');
  expect(subscribes).toHaveLength(1);
  stopFirst();
  await flush();
  expect(native.unlisten).not.toHaveBeenCalled();
  const late = native.handlers['plugin://discord/state'];
  stopSecond();
  late?.({ payload: { state: 'connecting' } });
  await flush();
  expect(second.at(-1)).toEqual(snapshot);
  expect(native.unlisten).toHaveBeenCalled();
  expect(native.invoke).toHaveBeenCalledWith('plugin_call', {
    plugin: 'discord',
    method: 'unsubscribe',
    params: null,
  });
});
