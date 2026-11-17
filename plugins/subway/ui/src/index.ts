import type { AppletStateField, Option, Param, Plugin, SettingsGroup } from '@supadashboard/kit';
import SubwayApplet from './ui/SubwayApplet.svelte';
import {
  ANNOUNCEMENT_LANGUAGE_PRESETS,
  DISPLAY_LANGUAGE_PRESETS,
  SUBWAY_DEFAULT_CONFIG,
} from './simulation/config';
import { LINE_CATALOGUE, lineFactsFor, PAUSED_LINES } from './data/load';
import {
  registerSubwayMixerChannel,
  SUBWAY_MIX_MUTED_ID,
  SUBWAY_MIX_VOLUME_ID,
} from './audio/audio-volume';
import {
  requestSubwayLine,
  requestSubwayView,
  dispatchSubwayCommand,
  setSubwayImmersion,
  runtime,
} from './simulation/runtime';
import guide from '../../guide.md?raw';
import market from '../../market.json';
import './plugin.css';

const pickableLines = LINE_CATALOGUE.filter((line) => !PAUSED_LINES.has(line.id));
const lineOptions: Option[] = [
  { value: '', label: 'Next line' },
  ...pickableLines.map((line) => ({ value: line.id, label: line.title })),
];
const directionOptions = (line?: string): Option[] => [
  { value: '', label: 'Automatic' },
  ...(lineFactsFor(line)?.directions ?? pickableLines.flatMap((item) => item.directions)).map(
    (direction) => ({ value: direction.id, label: direction.title }),
  ),
];
const stationOptions = (line?: string): Option[] => [
  { value: '', label: 'Default start' },
  ...(lineFactsFor(line)?.stations ?? pickableLines.flatMap((item) => item.stations)).map(
    (value) => ({ value, label: value }),
  ),
];
const displayOptions = (line?: string): Option[] => {
  const values = lineFactsFor(line)?.displayLanguages ?? DISPLAY_LANGUAGE_PRESETS;
  const titles: Record<string, string> = {
    'ja-en': 'Japanese / English',
    'ja-kana': 'Japanese / kana',
    'ja-zh': 'Japanese / Chinese',
    'ja-ko': 'Japanese / Korean',
  };
  return values.map((value) => ({ value, label: titles[value] }));
};
const announcementOptions: Option[] = ANNOUNCEMENT_LANGUAGE_PRESETS.map((value) => ({
  value,
  label: value === 'ja-en' ? 'Japanese / English' : value === 'ja' ? 'Japanese' : 'English',
}));
const lineParam: Param = {
  key: 'line',
  label: 'Line',
  type: 'select',
  default: '',
  suggestions: lineOptions,
};
const directionParam: Param = {
  key: 'direction',
  label: 'Direction',
  type: 'select',
  default: '',
  suggestions: (args) => directionOptions(args?.line as string | undefined),
};
const startStationParam: Param = {
  key: 'startStation',
  label: 'Start station',
  type: 'select',
  default: '',
  suggestions: (args) => stationOptions(args?.line as string | undefined),
};

const settings: SettingsGroup[] = [
  {
    id: 'route',
    title: 'Route',
    params: [
      {
        key: 'line',
        label: 'Line',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.line,
        suggestions: lineOptions.filter((option) => option.value),
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.direction,
        suggestions: (args) =>
          directionOptions(args?.line as string | undefined).filter((option) => option.value),
      },
      {
        key: 'startStation',
        label: 'Start station',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.startStation,
        suggestions: (args) =>
          stationOptions(args?.line as string | undefined).filter((option) => option.value),
      },
      {
        key: 'carNumber',
        label: 'Car number',
        type: 'select',
        default: '',
        suggestions: (args) => [
          { value: '', label: 'Random' },
          ...Array.from(
            {
              length:
                lineFactsFor(args?.line)?.carCount ??
                Math.max(...LINE_CATALOGUE.map((line) => line.carCount)),
            },
            (_, index) => ({ value: String(index + 1), label: String(index + 1) }),
          ),
        ],
      },
      {
        key: 'screen',
        label: 'Screen',
        type: 'select',
        default: 'left',
        suggestions: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
        // Only Hibiya has two physical screens.
        visible: (args) => args.line === 'hibiya',
      },
      {
        key: 'speed',
        label: 'Run speed',
        type: 'select',
        default: '1',
        suggestions: [0.5, 1, 2].map((value) => ({ value: String(value), label: `${value}×` })),
      },
    ],
  },
  {
    id: 'languages',
    title: 'Languages',
    params: [
      {
        key: 'displayLanguages',
        label: 'Display',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.displayLanguages,
        suggestions: (args) => displayOptions(args?.line as string | undefined),
      },
      {
        key: 'announcementLanguages',
        label: 'Announcements',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.announcementLanguages,
        suggestions: announcementOptions,
      },
    ],
  },
  {
    id: 'display',
    title: 'Display',
    params: [
      {
        key: 'view',
        label: 'View',
        type: 'select',
        default: 'display',
        suggestions: [
          { value: 'display', label: 'Display' },
          { value: 'map', label: 'Map' },
          { value: 'cab', label: 'Run' },
        ],
      },
      { key: 'fillScreen', label: 'Fill screen', type: 'boolean', default: true },
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    params: [
      {
        key: 'immersion',
        label: 'Immersion',
        type: 'boolean',
        default: SUBWAY_DEFAULT_CONFIG.immersion,
      },
      {
        key: 'announcementVolume',
        label: 'Announcement volume',
        type: 'number',
        default: SUBWAY_DEFAULT_CONFIG.announcementVolume,
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
];

const state: AppletStateField[] = [
  { key: 'station', type: 'string', initialValue: 'JY01' },
  { key: 'next', type: 'string', initialValue: 'JY02' },
  { key: 'state', type: 'string', initialValue: 'stopped' },
  { key: 'line', type: 'string', initialValue: 'yamanote' },
  { key: 'direction', type: 'string', initialValue: 'inner' },
  { key: 'doorSide', type: 'string', initialValue: 'unknown' },
  { key: 'speed', type: 'float', initialValue: 0 },
  { key: 'progress', type: 'float', initialValue: 0 },
  { key: 'paused', type: 'boolean', initialValue: true },
  { key: 'immersion', type: 'boolean', initialValue: false },
  { key: 'audioReady', type: 'boolean', initialValue: false },
];

const subwayPlugin: Plugin = {
  id: 'subway',
  ...market,
  guide,
  setup(api) {
    api.registerVariable({
      id: SUBWAY_MIX_VOLUME_ID,
      name: 'Subway mixer volume',
      type: 'float',
      initialValue: 1,
      persistent: true,
      readOnly: false,
    });
    api.registerVariable({
      id: SUBWAY_MIX_MUTED_ID,
      name: 'Subway mixer muted',
      type: 'boolean',
      initialValue: false,
      persistent: true,
      readOnly: false,
    });
    registerSubwayMixerChannel(api);
    api.registerAction({
      id: 'subway.line',
      title: 'Change Subway line',
      params: [lineParam, directionParam, startStationParam],
      run: (args, context) =>
        context?.signal.aborted
          ? false
          : requestSubwayLine(
              { line: args.line, direction: args.direction, startStation: args.startStation },
              context?.eventAncestry,
            ),
    });
    api.registerAction({
      id: 'subway.emergency',
      title: 'Subway emergency stop',
      run: (_args, context) =>
        context?.signal.aborted
          ? false
          : dispatchSubwayCommand({ type: 'emergency' }, context?.eventAncestry),
    });
    api.registerAction({
      id: 'subway.immersion',
      title: 'Toggle Subway immersion',
      run: (args, context) => {
        if (context?.signal.aborted) return false;
        return setSubwayImmersion(
          typeof args.enabled === 'boolean' ? args.enabled : undefined,
          context?.eventAncestry,
        );
      },
    });
    api.registerAction({
      id: 'subway.resume',
      title: 'Resume Subway service',
      run: (_args, context) =>
        context?.signal.aborted
          ? false
          : dispatchSubwayCommand({ type: 'resume-service' }, context?.eventAncestry),
    });
    api.registerAction({
      id: 'subway.suspend',
      title: 'Suspend Subway service',
      params: [{ key: 'enabled', label: 'Suspended', type: 'boolean', default: true }],
      run: (args, context) =>
        context?.signal.aborted
          ? false
          : dispatchSubwayCommand(
              args.enabled === false ? { type: 'resume-service' } : { type: 'suspend' },
              context?.eventAncestry,
            ),
    });
    api.registerAction({
      id: 'subway.view',
      title: 'Change Subway view',
      params: [
        {
          key: 'view',
          label: 'View',
          type: 'select',
          default: 'display',
          suggestions: [
            { value: 'display', label: 'Display' },
            { value: 'map', label: 'Map' },
            { value: 'cab', label: 'Run' },
          ],
        },
      ],
      run: (args, context) =>
        context?.signal.aborted
          ? false
          : requestSubwayView(String(args.view ?? 'display'), context?.eventAncestry),
    });

    api.registerApplet({
      id: 'subway',
      title: 'Subway',
      component: SubwayApplet,
      start: runtime,
      design: { width: 1920, height: 480 },
      background: '#10171b',
      slots: [
        {
          id: 'strip',
          kind: 'grid',
          accepts: ['button', 'slider'],
          max: 10,
          grid: { rows: 1, cols: 10, size: 112, gap: 8, sizing: 'auto' },
        },
      ],
      views: [
        { id: 'display', title: 'Display' },
        { id: 'map', title: 'Map' },
        { id: 'cab', title: 'Run' },
      ],
      defaultView: 'display',
      settings,
      quickSettings: ['view', 'announcementVolume', 'fillScreen'],
      quickActions: [
        { id: 'subway.line', args: { line: '', direction: '', startStation: '' } },
        { id: 'subway.emergency' },
        { id: 'subway.immersion' },
        { id: 'subway.resume' },
      ],
      state,
      events: [
        { id: 'subway.departed', title: 'Train departed', parameterSuggestions: () => [] },
        { id: 'subway.arrived', title: 'Train arrived', parameterSuggestions: () => [] },
        { id: 'subway.stateChanged', title: 'Run state changed', parameterSuggestions: () => [] },
        { id: 'subway.emergency', title: 'Emergency stop' },
        { id: 'subway.suspended', title: 'Service suspended' },
      ],
    });
  },
};

export default subwayPlugin;
