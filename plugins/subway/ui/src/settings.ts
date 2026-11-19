import type { Option, Param, SettingsGroup } from '@supadashboard/kit';
import { SUBWAY_DEFAULT_CONFIG } from './simulation/config';
import { LINE_CATALOGUE, lineFactsFor, PAUSED_LINES } from './data/load';
import { ANNOUNCEMENT_PRESETS, DISPLAY_PRESETS } from './data/presets';

export const SUBWAY_VIEWS = [
  { id: 'display', title: 'Display' },
  { id: 'map', title: 'Map' },
  { id: 'cab', title: 'Run' },
] as const;

const viewOptions: Option[] = SUBWAY_VIEWS.map((view) => ({ value: view.id, label: view.title }));
const pickableLines = LINE_CATALOGUE.filter((line) => !PAUSED_LINES.has(line.id));
const lineOptions: Option[] = [
  { value: '', label: 'Next line' },
  ...pickableLines.map((line) => ({ value: line.id, label: line.title })),
];

function directionOptions(line: unknown): Option[] {
  const directions =
    lineFactsFor(line)?.directions ?? pickableLines.flatMap((item) => item.directions);
  return [
    { value: '', label: 'Automatic' },
    ...directions.map((direction) => ({ value: direction.id, label: direction.title })),
  ];
}

function stationOptions(line: unknown): Option[] {
  const stations = lineFactsFor(line)?.stations ?? pickableLines.flatMap((item) => item.stations);
  return [
    { value: '', label: 'Default start' },
    ...stations.map((value) => ({ value, label: value })),
  ];
}

function displayOptions(line: unknown): Option[] {
  const values = lineFactsFor(line)?.displayLanguages ?? Object.keys(DISPLAY_PRESETS);
  return values.map((value) => ({ value, label: DISPLAY_PRESETS[value].label }));
}

function carOptions(line: unknown): Option[] {
  const count =
    lineFactsFor(line)?.carCount ?? Math.max(...LINE_CATALOGUE.map((item) => item.carCount));
  return [
    { value: '', label: 'Random' },
    ...Array.from({ length: count }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    })),
  ];
}

const chosen = (options: Option[]) => options.filter((option) => option.value);

/** The parameters of the line action; empty values keep the current run's choice. */
export const lineActionParams: Param[] = [
  { key: 'line', label: 'Line', type: 'select', default: '', suggestions: lineOptions },
  {
    key: 'direction',
    label: 'Direction',
    type: 'select',
    default: '',
    suggestions: (args) => directionOptions(args?.line),
  },
  {
    key: 'startStation',
    label: 'Start station',
    type: 'select',
    default: '',
    suggestions: (args) => stationOptions(args?.line),
  },
];

export const viewParam: Param = {
  key: 'view',
  label: 'View',
  type: 'select',
  default: 'display',
  suggestions: viewOptions,
};

export const subwaySettings: SettingsGroup[] = [
  {
    id: 'route',
    title: 'Route',
    params: [
      {
        key: 'line',
        label: 'Line',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.line,
        suggestions: chosen(lineOptions),
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.direction,
        suggestions: (args) => chosen(directionOptions(args?.line)),
      },
      {
        key: 'startStation',
        label: 'Start station',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.startStation,
        suggestions: (args) => chosen(stationOptions(args?.line)),
      },
      {
        key: 'carNumber',
        label: 'Car number',
        type: 'select',
        default: '',
        suggestions: (args) => carOptions(args?.line),
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
        suggestions: (args) => displayOptions(args?.line),
      },
      {
        key: 'announcementLanguages',
        label: 'Announcements',
        type: 'select',
        default: SUBWAY_DEFAULT_CONFIG.announcementLanguages,
        suggestions: Object.entries(ANNOUNCEMENT_PRESETS).map(([value, preset]) => ({
          value,
          label: preset.label,
        })),
      },
    ],
  },
  {
    id: 'display',
    title: 'Display',
    params: [
      viewParam,
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
