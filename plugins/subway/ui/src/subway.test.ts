import { describe, expect, it } from 'vitest';
import type { ActionDef, PluginApi } from '@supadashboard/app/features/plugins/contracts';
import {
  settingParams,
  validateAppletDefinition,
} from '@supadashboard/app/features/applets/definition';
import type { AppletDef } from '@supadashboard/app/features/applets/contracts';
import subwayPlugin from './index';

function collect() {
  const actions = new Map<string, ActionDef>();
  let applet: AppletDef | undefined;
  subwayPlugin.setup({
    registerAction: (action: ActionDef) => {
      actions.set(action.id, action);
    },
    registerApplet: (definition: AppletDef) => {
      applet = definition;
    },
    registerVariable: () => {},
  } as unknown as PluginApi);
  if (!applet) throw new Error('Subway applet was not registered');
  return { actions, applet };
}

describe('Subway applet registration', () => {
  it('keeps the setting keys, state, event and action ids that saved pages and scenarios reference', () => {
    const { actions, applet } = collect();
    validateAppletDefinition(applet);
    expect(settingParams(applet.settings).map((param) => param.key)).toEqual([
      'line',
      'direction',
      'startStation',
      'carNumber',
      'screen',
      'speed',
      'displayLanguages',
      'announcementLanguages',
      'view',
      'fillScreen',
      'immersion',
      'announcementVolume',
    ]);
    expect(applet.state?.map((field) => field.key)).toEqual([
      'station',
      'next',
      'state',
      'line',
      'direction',
      'doorSide',
      'speed',
      'progress',
      'paused',
      'immersion',
      'audioReady',
    ]);
    expect(applet.events?.map((event) => event.id)).toEqual([
      'subway.departed',
      'subway.arrived',
      'subway.stateChanged',
      'subway.emergency',
      'subway.suspended',
    ]);
    expect(applet.quickActions?.map((action) => action.id)).toEqual([
      'subway.line',
      'subway.emergency',
      'subway.immersion',
      'subway.resume',
    ]);
    const keys = settingParams(applet.settings).map((param) => param.key);
    expect(applet.quickSettings?.every((key) => keys.includes(key))).toBe(true);
    expect([...actions.keys()]).toEqual([
      'subway.line',
      'subway.emergency',
      'subway.immersion',
      'subway.resume',
      'subway.suspend',
      'subway.view',
    ]);
  });
});
