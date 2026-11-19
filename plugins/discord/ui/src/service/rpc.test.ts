import { expect, it, vi } from 'vitest';

const pipe = vi.hoisted(() => ({
  sent: [] as { op: number; data: any }[],
  emit: (() => {}) as (event: unknown) => void,
}));
vi.mock('@supadashboard/kit', () => ({
  isRecord: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  pluginPipe: {
    open: async (_plugin: string, _name: string, onEvent: (event: unknown) => void) => {
      pipe.emit = onEvent;
      return 1;
    },
    send: async (_plugin: string, _handle: number, op: number, data: unknown) => {
      pipe.sent.push({ op, data });
    },
    close: async () => {},
  },
}));

import { Rpc } from './rpc';

const frame = (data: unknown, op = 1) => pipe.emit({ kind: 'frame', op, data });

it('answers pings and cannot complete a request with a stale nonce or a dispatch', async () => {
  const events = vi.fn();
  const connecting = Rpc.connect('123456789012345678', events, () => {});
  await vi.waitFor(() => expect(pipe.sent).toHaveLength(1));
  frame({ cmd: 'DISPATCH', evt: 'READY' });
  const rpc = await connecting;
  const reply = rpc.request('GET_SELECTED_VOICE_CHANNEL', {});
  await vi.waitFor(() => expect(pipe.sent).toHaveLength(2));
  const nonce = pipe.sent[1].data.nonce;
  frame({ ping: 1 }, 3);
  frame({ cmd: 'DISPATCH', evt: 'VOICE_CHANNEL_SELECT', data: { channel_id: null } });
  frame({ cmd: 'GET_SELECTED_VOICE_CHANNEL', nonce: 'stale', data: 'wrong' });
  frame({ cmd: 'GET_SELECTED_VOICE_CHANNEL', nonce, data: null });
  expect(await reply).toBeNull();
  expect(rpc.events.map((event) => event.evt)).toEqual(['VOICE_CHANNEL_SELECT']);
  expect(pipe.sent.at(-1)).toEqual({ op: 4, data: { ping: 1 } });
  rpc.close();
});

it('closes the connection instead of growing the dispatch queue without bound', async () => {
  pipe.sent.length = 0;
  const closed = vi.fn();
  const connecting = Rpc.connect('123456789012345678', () => {}, closed);
  await vi.waitFor(() => expect(pipe.sent).toHaveLength(1));
  frame({ cmd: 'DISPATCH', evt: 'READY' });
  const rpc = await connecting;
  for (let index = 0; index <= 512; index++) {
    frame({ cmd: 'DISPATCH', evt: 'SPEAKING_START', data: {} });
  }
  expect(closed).toHaveBeenCalled();
  await expect(rpc.request('GET_VOICE_SETTINGS', {})).rejects.toThrow('closed');
});
