import { isTauri } from '@tauri-apps/api/core';
import { currentRuntime, type Plugin, onPluginEvent } from '@supadashboard/kit';
import { configureHaptics, pulse, PULSE_KINDS, type PulseKind } from './haptics';
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
    if (!isTauri()) {
      return;
    }
    let current: HapticsSettings = DEFAULTS;
    // The native side keeps the last configuration, so both windows applying the same one is harmless.
    loadSettings()
      .then((saved) => {
        current = saved;
        return saved.enabled ? configureHaptics(toConfig(saved)) : undefined;
      })
      .catch((error) => console.warn('haptics', error));
    onPluginEvent('haptics', 'restarted', () => {
      if (current.enabled) {
        configureHaptics(toConfig(current)).catch((error) => console.warn('haptics', error));
      }
    }).catch((error) => console.warn('haptics', error));
    watchSettings((saved) => (current = saved)).catch((error) => console.warn('haptics', error));
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
