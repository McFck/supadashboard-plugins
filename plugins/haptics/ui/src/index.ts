import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentRuntime, providePlugin, whileOwner, type Plugin } from '@supadashboard/kit';
import { launchArtemis, pulse, PULSE_KINDS, type PulseKind } from './haptics';
import { HapticsService } from './service';
import HapticsSection from './components/HapticsSection.svelte';
import { DEFAULTS, loadSettings, toConfig, watchSettings, type HapticsSettings } from './settings';
import guide from '../../guide.md?raw';
import market from '../../market.json';
import './plugin.css';

const isKind = (value: unknown): value is PulseKind => PULSE_KINDS.includes(value as PulseKind);

const hapticsPlugin: Plugin = {
  id: 'haptics',
  ...market,
  settingsSection: HapticsSection,
  guide,
  setup(api) {
    api.registerIcon(
      'vibrate',
      'M12 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3M2 8l2 2-2 2 2 2-2 2M22 8l-2 2 2 2-2 2 2 2',
    );
    api.registerAction({
      id: 'haptics.pulse',
      title: 'Vibrate',
      params: [
        {
          key: 'kind',
          label: 'Kind',
          type: 'select',
          default: 'tap',
          suggestions: PULSE_KINDS.map((kind) => ({
            value: kind,
            label: kind[0].toUpperCase() + kind.slice(1),
          })),
        },
      ],
      run: ({ kind }) => {
        if (!isKind(kind)) {
          throw new Error('Unknown vibration');
        }
        pulse(kind);
      },
    });
    api.registerAction({
      id: 'haptics.launch-artemis',
      title: 'Launch Artemis',
      run: launchArtemis,
    });
    if (!isTauri()) {
      return;
    }
    let current: HapticsSettings = DEFAULTS;
    // The service runs in the dashboard owner only; the panel reaches it through callPlugin.
    whileOwner(() => {
      const service = new HapticsService();
      const unprovide = providePlugin('haptics', {
        configure: service.configure,
        pulse: service.pulse,
        tabletReady: service.tabletReady,
        launchArtemis: service.launchArtemis,
      });
      let stopped = false;
      let unwatch: (() => void) | undefined;
      let unlisten: (() => void) | undefined;
      listen('plugin-power-resumed', () => {
        if (!stopped) {
          void service.resume().catch(console.warn);
        }
      })
        .then((stop) => (stopped ? stop() : (unlisten = stop)))
        .catch(console.warn);
      loadSettings()
        .then((saved) => {
          if (stopped) {
            return;
          }
          current = saved;
          return saved.enabled ? service.configure(toConfig(saved)) : undefined;
        })
        .catch((error) => console.warn('haptics', error));
      watchSettings((saved) => (current = saved))
        .then((stop) => (stopped ? stop() : (unwatch = stop)))
        .catch((error) => console.warn('haptics', error));
      return () => {
        stopped = true;
        unlisten?.();
        unwatch?.();
        unprovide();
        service.destroy();
      };
    });
    api.onTrigger((trigger) => {
      if (
        trigger === 'press' &&
        current.enabled &&
        current.pressPulse &&
        currentRuntime()?.isOwner
      ) {
        pulse('tap');
      }
    });
  },
};
export default hapticsPlugin;
