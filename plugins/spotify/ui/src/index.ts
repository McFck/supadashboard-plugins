import { invoke } from '@tauri-apps/api/core';
import {
  toast,
  currentRuntime,
  emptyScenario,
  type Plugin,
  type PluginApi,
  nativeSessions,
  ownerAction,
  whileOwner,
} from '@supadashboard/kit';
import { spotifyCommand, spotifyTransport, subscribeSpotify } from './spotify';
import { provideSpotify } from './service';
import { playingSession } from './lyric-clock';
import { setStepFeedback } from './components/offset-ruler';
import ConnectionSection from './components/ConnectionSection.svelte';
import LyricsEditor from './components/LyricsEditor.svelte';
import LyricsTile from './components/LyricsTile.svelte';
import guide from '../../guide.md?raw';
import market from '../../market.json';
import './plugin.css';

/** Mirrors the Web API and the media session into variables; the last error toast is kept across owners. */
function followSpotify(api: PluginApi) {
  let lastError: string | undefined;
  const set = (values: Record<string, boolean | string>) => {
    if (!currentRuntime()?.isOwner) {
      return;
    }
    void Promise.all(
      Object.entries(values).map(([field, value]) => api.setVariable(`spotify.${field}`, value)),
    ).catch(() => toast.error('Spotify state unavailable'));
  };
  return () => {
    let smartShuffle = false;
    let shuffle = false;
    let webShuffle: boolean | undefined;
    const shuffleValue = () => {
      if (smartShuffle) {
        return 'smart';
      }
      return (webShuffle ?? shuffle) ? 'shuffle' : 'off';
    };
    const stopSpotify = subscribeSpotify((view) => {
      if (!currentRuntime()?.isOwner) {
        return;
      }
      smartShuffle = view.state === 'ready' && view.smartShuffle;
      webShuffle = view.state === 'ready' ? view.shuffle : undefined;
      set({
        connected: view.state === 'ready',
        liked: view.state === 'ready' && view.liked === true,
        shuffle: shuffleValue(),
      });
      if (view.error && view.error !== lastError) {
        toast.error(view.error);
      }
      lastError = view.error;
    });
    const controller = new AbortController();
    const stopMedia = nativeSessions('spotify')((state) => {
      const session = playingSession(state.state === 'ready' ? state.sessions : []);
      shuffle = session?.shuffle === true;
      set({ shuffle: shuffleValue(), repeat: session?.repeat ?? 'off' });
    }, controller.signal);
    return () => {
      stopSpotify();
      controller.abort();
      stopMedia();
    };
  };
}

function registerActions(api: PluginApi) {
  for (const [op, title] of [
    ['like', 'Like song'],
    ['unlike', 'Unlike song'],
    ['dislike', 'Dislike song'],
  ] as const) {
    api.registerAction({
      id: `spotify.${op}`,
      title,
      bindableVariable: () => 'spotify.liked',
      run: ownerAction('Spotify', () => spotifyCommand(op)),
    });
  }
  for (const [op, title, modes, initial] of [
    [
      'shuffle',
      'Shuffle',
      [
        ['on', 'On'],
        ['off', 'Off'],
        ['toggle', 'Toggle'],
      ],
      'toggle',
    ],
    [
      'repeat',
      'Repeat',
      [
        ['off', 'Off'],
        ['context', 'Playlist'],
        ['track', 'Song'],
        ['cycle', 'Cycle'],
      ],
      'cycle',
    ],
  ] as const) {
    api.registerAction({
      id: `spotify.${op}`,
      title,
      bindableVariable: () => `spotify.${op}`,
      params: [
        {
          key: 'mode',
          label: 'Mode',
          type: 'select',
          default: initial,
          suggestions: modes.map(([value, label]) => ({ value, label })),
        },
      ],
      run: ownerAction('Spotify', (args) =>
        spotifyTransport(`${op}:${String(args.mode ?? initial)}`),
      ),
    });
  }
}

function registerVariables(api: PluginApi) {
  for (const field of ['liked', 'shuffle', 'connected', 'repeat'] as const) {
    api.registerVariable({
      id: `spotify.${field}`,
      name: `spotify.${field}`,
      type: field === 'repeat' || field === 'shuffle' ? 'string' : 'boolean',
      initialValue: field === 'repeat' || field === 'shuffle' ? 'off' : false,
      ...(field === 'shuffle' ? { options: ['off', 'shuffle', 'smart'] } : {}),
      ...(field === 'repeat' ? { options: ['off', 'context', 'track'] } : {}),
      persistent: false,
      readOnly: true,
    });
  }
}

const spotifyPlugin: Plugin = {
  id: 'spotify',
  ...market,
  settingsSection: ConnectionSection,
  guide,
  setup(api) {
    api.registerIcon(
      'spotify',
      'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20zM7 9.5c3.5-1 7.5-.6 10.5 1M7.5 12.6c3-.8 6.3-.4 8.8 1M8 15.6c2.5-.6 5-.3 7 .8',
    );
    api.registerAppIcon('spotify', 'spotify');
    setStepFeedback(() => api.runAction('haptics.pulse', { kind: 'tick' }));
    api.registerMediaSource({
      id: 'spotify',
      title: 'Spotify',
      // The native side matches Windows media sessions by app id; "spotify" picks the desktop app.
      command: (command, sessionId) =>
        invoke('media_command', { target: 'spotify', command, sessionId }),
    });
    api.registerStatusSource({
      id: 'spotify',
      title: 'Spotify',
      kind: 'nowPlaying',
      mediaSourceId: 'spotify',
      subscribe: nativeSessions('spotify'),
    });
    api.registerControl({
      type: 'spotifyLyrics',
      title: 'Lyrics',
      icon: 'spotify',
      component: LyricsTile,
      editor: LyricsEditor,
      size: { w: 2, h: 3 },
      minSize: { w: 2, h: 1 },
      maxSize: { w: 8, h: 8 },
      triggers: [],
      create: () => ({
        name: 'Lyrics',
        scenario: emptyScenario(),
        variants: [{ id: 'state-1', label: '' }],
      }),
    });
    registerActions(api);
    registerVariables(api);
    whileOwner(provideSpotify);
    whileOwner(followSpotify(api));
  },
};
export default spotifyPlugin;
