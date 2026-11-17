import { describe, expect, it, vi } from 'vitest';
import { readSpotifyView, spotifyTransport } from './spotify';
import { ActionFailure, callPlugin } from '@supadashboard/kit';
import { readSourceState } from '@supadashboard/app/features/media/now-playing-read';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@supadashboard/kit', async (original) => ({
  ...(await original<object>()),
  callPlugin: vi.fn(),
}));

describe('Spotify trust boundaries', () => {
  it('awaits native shuffle completion and propagates failure without trying another toggle', async () => {
    let finish: (() => void) | undefined;
    vi.mocked(callPlugin).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    let completed = false;
    const pending = spotifyTransport('shuffle:toggle').then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish?.();
    await pending;
    expect(completed).toBe(true);
    for (const mode of ['on', 'off', 'toggle']) {
      vi.mocked(callPlugin).mockRejectedValueOnce('native failure');
      await expect(spotifyTransport(`shuffle:${mode}`)).rejects.toEqual(
        new ActionFailure('native failure'),
      );
      expect(callPlugin).toHaveBeenLastCalledWith('spotify', 'shuffle', { mode });
    }
    vi.mocked(callPlugin).mockRejectedValueOnce('Turn off smart shuffle in Spotify');
    await expect(spotifyTransport('shuffle:toggle')).rejects.toEqual(
      new ActionFailure('Turn off smart shuffle in Spotify'),
    );
    vi.mocked(callPlugin).mockRejectedValueOnce(new Error("Spotify isn't playing"));
    await expect(spotifyTransport('shuffle:on')).rejects.toEqual(
      new ActionFailure("Spotify isn't playing"),
    );
    for (const error of ['x'.repeat(81), 'unsafe\nerror', { message: 'not a native title' }]) {
      vi.mocked(callPlugin).mockRejectedValueOnce(error);
      await expect(spotifyTransport('shuffle:off')).rejects.toEqual(
        new ActionFailure('Spotify shuffle failed'),
      );
    }
    await expect(spotifyTransport('shuffle:smart')).rejects.toThrow('Invalid Spotify command');
  });
  const ready = {
    state: 'ready',
    user: 'Listener',
    trackUri: 'spotify:track:0123456789ABCDEFGHIJKL',
    liked: true,
    smartShuffle: false,
  };
  it('rejects malformed account snapshots and track identities', () => {
    expect(readSpotifyView({ ...ready, extra: 'discard' })).toEqual(ready);
    for (const raw of [
      null,
      {},
      { state: 'unknown' },
      { ...ready, trackUri: 'spotify:track:bad' },
      { ...ready, user: '\u0000' },
      { ...ready, liked: 1 },
      { ...ready, smartShuffle: 'true' },
      { ...ready, shuffle: 'true' },
      { ...ready, trackUri: null },
      { ...ready, error: {} },
    ]) {
      expect(readSpotifyView(raw)).toBeUndefined();
    }
    expect(readSpotifyView({ ...ready, trackUri: null, liked: null })).toEqual({
      ...ready,
      trackUri: null,
      liked: null,
    });
  });
  it('rejects invalid GSMTC shuffle and repeat states at the media boundary', () => {
    const session = {
      sessionId: 'spotify#1',
      title: '',
      artist: '',
      album: '',
      state: 'playing',
      current: true,
      shuffle: true,
      repeat: 'context',
    };
    const snapshot = (next: object) => ({ state: 'ready', sessions: [next] });
    expect(readSourceState(snapshot(session))).toEqual(snapshot(session));
    for (const next of [
      { ...session, repeat: 'unknown' },
      { ...session, shuffle: 1 },
    ]) {
      expect(readSourceState(snapshot(next))).toBeNull();
    }
  });
});
