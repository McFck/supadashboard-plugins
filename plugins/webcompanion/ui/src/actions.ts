import {
  ActionFailure,
  ownerAction,
  type PluginApi,
  type PluginBrowserAction,
} from '@supadashboard/kit';
import { webCompanion } from './webcompanion.svelte';

type Action = Parameters<PluginApi['registerAction']>[0];
type FixedAction = [string, string, PluginBrowserAction, string?];

const fixed: FixedAction[] = [
  ['tab.next', 'Next tab', { kind: 'tab', input: 'next' }],
  ['tab.previous', 'Previous tab', { kind: 'tab', input: 'previous' }],
  ['tab.new', 'New tab', { kind: 'tab', input: 'new' }],
  ['tab.close', 'Close tab', { kind: 'tab', input: 'close' }],
  ['tab.reopen', 'Reopen closed tab', { kind: 'tab', input: 'reopen' }],
  ['page.back', 'Back', { kind: 'page', input: { kind: 'back' } }],
  ['page.forward', 'Forward', { kind: 'page', input: { kind: 'forward' } }],
  ['page.reload', 'Reload page', { kind: 'page', input: { kind: 'reload' } }],
  ['page.top', 'Scroll to top', { kind: 'page', input: { kind: 'top' } }],
  ['page.bottom', 'Scroll to bottom', { kind: 'page', input: { kind: 'bottom' } }],
  ['page.pageUp', 'Page up', { kind: 'page', input: { kind: 'page_up' } }],
  ['page.pageDown', 'Page down', { kind: 'page', input: { kind: 'page_down' } }],
  ['media.play', 'Play browser media', { kind: 'media', input: { kind: 'play' } }],
  ['media.pause', 'Pause browser media', { kind: 'media', input: { kind: 'pause' } }],
  [
    'media.toggle',
    'Play or pause browser media',
    { kind: 'media', input: { kind: 'toggle' } },
    'playing',
  ],
  ['media.back10', 'Back 10 seconds', { kind: 'media', input: { kind: 'seek', seconds: -10 } }],
  [
    'media.forward10',
    'Forward 10 seconds',
    { kind: 'media', input: { kind: 'seek', seconds: 10 } },
  ],
  ['media.fullscreen', 'Fullscreen video window', { kind: 'media', input: { kind: 'fullscreen' } }],
  ['window.fullscreen', 'Fullscreen browser', { kind: 'window_fullscreen' }],
];

export const browserActions: Action[] = [
  {
    id: 'webcompanion.open',
    title: 'Open website',
    params: [
      { key: 'url', label: 'URL', type: 'text' },
      {
        key: 'destination',
        label: 'Open in',
        type: 'select',
        default: 'new',
        suggestions: [
          { value: 'new', label: 'New tab' },
          { value: 'current', label: 'Current tab' },
        ],
      },
    ],
    run: ownerAction('WebCompanion', (args) => {
      const destination = args.destination ?? 'new';
      if (typeof args.url !== 'string') {
        throw new ActionFailure('Enter a valid HTTP or HTTPS URL');
      }
      if (destination !== 'new' && destination !== 'current') {
        throw new ActionFailure('Choose a tab destination');
      }
      return webCompanion.execute({ kind: 'open', url: args.url, destination });
    }),
  },
  ...fixed.map(([id, title, action, variable]) => ({
    id: `webcompanion.${id}`,
    title,
    bindableVariable: variable ? () => `webcompanion.${variable}` : undefined,
    run: ownerAction('WebCompanion', () => webCompanion.execute(action)),
  })),
  {
    id: 'webcompanion.media.seek',
    title: 'Skip browser media',
    params: [
      { key: 'seconds', label: 'Seconds', type: 'number', default: 10, min: -600, max: 600 },
    ],
    run: ownerAction('WebCompanion', (args) => {
      const seconds = args.seconds ?? 10;
      if (typeof seconds !== 'number' || !Number.isInteger(seconds) || Math.abs(seconds) > 600) {
        throw new ActionFailure('Enter a whole number of seconds from −600 to 600');
      }
      return webCompanion.execute({ kind: 'media', input: { kind: 'seek', seconds } });
    }),
  },
  {
    id: 'webcompanion.media.speed',
    title: 'Browser playback speed',
    params: [
      {
        key: 'rate',
        label: 'Speed',
        type: 'select',
        default: '1',
        suggestions: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => ({
          value: String(rate),
          label: `${rate}×`,
        })),
      },
    ],
    run: ownerAction('WebCompanion', (args) => {
      const rate = Number(args.rate ?? '1');
      if (!(rate >= 0.25 && rate <= 4)) {
        throw new ActionFailure('Choose a playback speed');
      }
      return webCompanion.execute({ kind: 'media', input: { kind: 'speed', rate } });
    }),
  },
  {
    id: 'webcompanion.media.suspend',
    title: 'Suspend browser media',
    bindableVariable: () => 'webcompanion.mediaSuspended',
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'toggle',
        suggestions: [
          { value: 'toggle', label: 'Toggle' },
          { value: 'on', label: 'Suspend' },
          { value: 'off', label: 'Resume' },
        ],
      },
    ],
    run: ownerAction('WebCompanion', (args) => {
      const mode = args.mode ?? 'toggle';
      if (mode !== 'toggle' && mode !== 'on' && mode !== 'off') {
        throw new ActionFailure('Choose a suspend mode');
      }
      return webCompanion.execute({ kind: 'suspend', mode });
    }),
  },
];
