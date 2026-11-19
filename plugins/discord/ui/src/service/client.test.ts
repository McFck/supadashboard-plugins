import { expect, it, vi } from 'vitest';
import { Client } from './client';

const first = '123456789012345671';
const second = '123456789012345672';
const user = { id: '123456789012345673', name: 'Owner' };
const guildId = '123456789012345674';

const pipe = vi.hoisted(() => ({
  onFrame: (_data: unknown) => {},
  reply: (_cmd: string): unknown => null,
}));

vi.mock('@supadashboard/kit', () => ({
  isRecord: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  pluginSecrets: {
    read: async () => ({ signedIn: false, fields: {}, expiresAt: null }),
    write: async () => {},
  },
  pluginPipe: {
    open: async (_plugin: string, _name: string, receive: (event: unknown) => void) => {
      pipe.onFrame = (data) => receive({ kind: 'frame', op: 1, data });
      return 1;
    },
    close: async () => {},
    send: async (_plugin: string, _handle: number, op: number, data: unknown) => {
      if (op === 0) {
        pipe.onFrame({ cmd: 'DISPATCH', evt: 'READY' });
        return;
      }
      const { cmd, nonce } = data as { cmd: string; nonce: string };
      pipe.onFrame({ cmd, nonce, data: pipe.reply(cmd) });
    },
  },
}));

it('shows the new channel when Discord moves the user during an older snapshot', async () => {
  vi.useFakeTimers();
  let selected = first;
  let moveDuringRead = false;
  const snapshot = (id: string) => ({
    id,
    name: id === first ? 'Original room' : 'Destination room',
    type: 2,
    guild_id: guildId,
    voice_states: [],
  });
  pipe.reply = (cmd) => {
    if (cmd === 'GET_CHANNELS') {
      return {
        channels: [
          { id: first, permission_overwrites: [] },
          { id: second, permission_overwrites: [{ id: guildId, type: 0, deny: '1048576' }] },
        ],
      };
    }
    if (cmd !== 'GET_SELECTED_VOICE_CHANNEL') {
      return null;
    }
    const data = snapshot(selected);
    if (moveDuringRead) {
      moveDuringRead = false;
      selected = second;
      pipe.onFrame({ cmd: 'DISPATCH', evt: 'VOICE_CHANNEL_SELECT', data: { channel_id: second } });
    }
    return data;
  };
  const published = vi.fn();
  const client = new Client(published);

  try {
    await client.run(async () => {
      await client.openRpc(user.id);
      client.voice = { ...client.voice, user };
      await client.selected();
      client.connected();
    });
    expect(published).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: expect.objectContaining({ id: first, access: 'open' }) }),
    );

    moveDuringRead = true;
    await client.run(() => client.selected());
    expect(published).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: 'inVoice',
        channel: expect.objectContaining({
          id: second,
          name: 'Destination room',
          access: 'restricted',
        }),
      }),
    );

    selected = first;
    await vi.advanceTimersByTimeAsync(2000);
    expect(published).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel: expect.objectContaining({ id: first, access: 'open' }),
      }),
    );
  } finally {
    client.destroy();
    vi.useRealTimers();
  }
});
