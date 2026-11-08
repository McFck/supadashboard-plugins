import { afterEach, expect, it, vi } from 'vitest';
import type { PluginApi } from '@supadashboard/kit';
import type { NowPlayingSourceState } from '@supadashboard/app/features/plugins/contracts';
import type { SpotifyView } from './spotify';
import { VariableStore } from '@supadashboard/app/features/automation/variables';
import { runtimeView, EMPTY } from '@supadashboard/app/app/runtime/state';
import spotifyPlugin from './index';

const sources = vi.hoisted(() => ({
  owner: true,
  spotify: (_view: SpotifyView) => {},
  media: (_view: NowPlayingSourceState) => {},
}));
vi.mock('@supadashboard/app/app/runtime/session.svelte', () => ({
  currentRuntime: () => ({ isOwner: sources.owner }),
}));
vi.mock('./spotify', () => ({
  subscribeSpotify: (receive: typeof sources.spotify) => {
    sources.spotify = receive;
    return () => {};
  },
  spotifyCommand: vi.fn(),
  spotifyTransport: vi.fn(),
}));
vi.mock('@supadashboard/app/platform/media', () => ({
  nativeSessions: () => (receive: typeof sources.media) => {
    sources.media = receive;
    return () => {};
  },
}));

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
});

it('keeps smart shuffle across media updates and falls back to media when Web API disconnects', () => {
  vi.stubGlobal('window', new EventTarget());
  const variables = new VariableStore();
  const api: PluginApi = {
    registerAction: () => {},
    registerValue: () => {},
    registerControl: () => {},
    registerApplet: () => {},
    registerMediaSource: () => {},
    registerStatusSource: () => {},
    registerIcon: () => {},
    registerAppIcon: () => {},
    runAction: () => {},
    onTrigger: () => () => {},
    registerVariable: (definition) => {
      variables.define({ ...definition, owner: 'spotify' }, 'spotify');
    },
    listVariables: () => Object.values(variables.snapshot().records),
    setVariable: async (id, value) => variables.set(id, value, 'spotify'),
  };
  spotifyPlugin.setup(api);
  const ready: SpotifyView = {
    state: 'ready',
    user: 'Listener',
    trackUri: null,
    liked: null,
    smartShuffle: true,
  };
  const media = (shuffle: boolean) =>
    sources.media({
      state: 'ready',
      sessions: [
        {
          sessionId: 'spotify',
          title: '',
          artist: '',
          album: '',
          state: 'playing',
          current: true,
          shuffle,
        },
      ],
    });
  expect(variables.getValue('spotify.shuffle')).toBe('off');
  expect(variables.get('spotify.smartShuffle')).toBeUndefined();
  expect(variables.serializePersistent().records).toEqual([]);
  media(true);
  expect(variables.getValue('spotify.shuffle')).toBe('shuffle');
  sources.spotify({ ...ready, smartShuffle: false, shuffle: false });
  expect(variables.getValue('spotify.shuffle')).toBe('off');
  sources.spotify({ ...ready, smartShuffle: false, shuffle: true });
  media(false);
  expect(variables.getValue('spotify.shuffle')).toBe('shuffle');
  sources.spotify({ state: 'needsAuth' });
  expect(variables.getValue('spotify.shuffle')).toBe('off');
  sources.spotify(ready);
  media(false);
  expect(variables.getValue('spotify.shuffle')).toBe('smart');
  sources.spotify({ state: 'connecting' });
  expect(variables.getValue('spotify.shuffle')).toBe('off');
  media(true);
  sources.spotify(ready);
  sources.spotify({ state: 'needsAuth' });
  expect(variables.getValue('spotify.shuffle')).toBe('shuffle');
  sources.owner = false;
  runtimeView.set(EMPTY);
  sources.spotify(ready);
  media(false);
  expect(variables.getValue('spotify.shuffle')).toBe('shuffle');
});
