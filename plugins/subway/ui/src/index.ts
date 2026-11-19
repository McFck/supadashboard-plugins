import type { AppletStateField, EventAncestry, Plugin, PluginApi } from '@supadashboard/kit';
import SubwayApplet from './ui/SubwayApplet.svelte';
import { SUBWAY_DEFAULT_CONFIG } from './simulation/config';
import { LINE_CATALOGUE } from './data/load';
import {
  registerSubwayMixerChannel,
  SUBWAY_MIX_MUTED_ID,
  SUBWAY_MIX_VOLUME_ID,
} from './audio/audio-volume';
import {
  dispatchSubwayCommand,
  requestSubwayLine,
  requestSubwayView,
  runtime,
  setSubwayImmersion,
} from './simulation/active-runtime';
import { lineActionParams, SUBWAY_VIEWS, subwaySettings, viewParam } from './settings';
import guide from '../../guide.md?raw';
import market from '../../market.json';
import './plugin.css';

type ActionRun = Parameters<PluginApi['registerAction']>[0]['run'];

/** Runs an action unless its control already cancelled it. */
function unlessAborted(
  run: (args: Record<string, unknown>, ancestry?: EventAncestry) => boolean | Promise<boolean>,
): ActionRun {
  return (args, context) => (context?.signal.aborted ? false : run(args, context?.eventAncestry));
}

const [firstLine] = LINE_CATALOGUE;
const firstStep = firstLine.directions[0].delta;
const state: AppletStateField[] = [
  { key: 'station', type: 'string', initialValue: SUBWAY_DEFAULT_CONFIG.startStation },
  {
    key: 'next',
    type: 'string',
    initialValue: firstLine.stations.at(firstStep) ?? SUBWAY_DEFAULT_CONFIG.startStation,
  },
  { key: 'state', type: 'string', initialValue: 'stopped' },
  { key: 'line', type: 'string', initialValue: SUBWAY_DEFAULT_CONFIG.line },
  { key: 'direction', type: 'string', initialValue: SUBWAY_DEFAULT_CONFIG.direction },
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
      params: lineActionParams,
      run: unlessAborted((args, ancestry) =>
        requestSubwayLine(
          { line: args.line, direction: args.direction, startStation: args.startStation },
          ancestry,
        ),
      ),
    });
    api.registerAction({
      id: 'subway.emergency',
      title: 'Subway emergency stop',
      run: unlessAborted((_args, ancestry) =>
        dispatchSubwayCommand({ type: 'emergency' }, ancestry),
      ),
    });
    api.registerAction({
      id: 'subway.immersion',
      title: 'Toggle Subway immersion',
      run: unlessAborted((args, ancestry) =>
        setSubwayImmersion(typeof args.enabled === 'boolean' ? args.enabled : undefined, ancestry),
      ),
    });
    api.registerAction({
      id: 'subway.resume',
      title: 'Resume Subway service',
      run: unlessAborted((_args, ancestry) =>
        dispatchSubwayCommand({ type: 'resume-service' }, ancestry),
      ),
    });
    api.registerAction({
      id: 'subway.suspend',
      title: 'Suspend Subway service',
      params: [{ key: 'enabled', label: 'Suspended', type: 'boolean', default: true }],
      run: unlessAborted((args, ancestry) =>
        dispatchSubwayCommand(
          args.enabled === false ? { type: 'resume-service' } : { type: 'suspend' },
          ancestry,
        ),
      ),
    });
    api.registerAction({
      id: 'subway.view',
      title: 'Change Subway view',
      params: [viewParam],
      run: unlessAborted((args, ancestry) =>
        requestSubwayView(String(args.view ?? 'display'), ancestry),
      ),
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
      views: SUBWAY_VIEWS.map((view) => ({ ...view })),
      defaultView: 'display',
      settings: subwaySettings,
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
