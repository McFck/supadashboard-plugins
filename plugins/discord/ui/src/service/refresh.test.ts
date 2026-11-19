import { expect, it, vi } from 'vitest';
import { Client } from './client';

const oauth = vi.hoisted(() => ({ failure: 'Token request failed' as string | undefined }));

vi.mock('@supadashboard/kit', () => ({
  isRecord: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  pluginSecrets: {
    read: async () => ({
      signedIn: true,
      fields: { clientId: '123456789012345678' },
      expiresAt: Date.now() + 30_000,
    }),
    write: async () => {},
  },
  pluginOAuth: {
    refresh: async () => {
      if (oauth.failure) {
        throw oauth.failure;
      }
    },
  },
  pluginPipe: {
    open: async () => {
      throw new Error('No pipe');
    },
  },
}));

it.each([
  ['keeps the account after a transient refresh failure', 'Token request failed', 'absent'],
  ['needs sign-in again after Discord rejected the refresh token', 'Sign in again', 'needsAuth'],
])('%s', async (_name, failure, phase) => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  oauth.failure = failure;
  const client = new Client(() => {});
  try {
    await client.run(async () => {
      client.phase = 'ready';
      client.rpc = { close() {}, events: [] } as never;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(client.phase).toBe(phase);
  } finally {
    client.destroy();
    vi.useRealTimers();
  }
});
