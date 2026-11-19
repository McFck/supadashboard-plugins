import { onPluginEvent, toast } from '@supadashboard/kit';
import { configureHaptics, launchArtemis, tabletReady } from '../haptics';
import {
  DEFAULTS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  toConfig,
  type HapticsSettings,
} from '../settings';

export class HapticsSectionController {
  settings = $state<HapticsSettings>({ ...DEFAULTS });
  loaded = $state(false);
  connected = $state(false);
  saving = $state(false);
  launching = $state(false);
  #active = true;
  #queue: Promise<void> = Promise.resolve();
  #listeners = [
    onPluginEvent('haptics', 'tablet-ready', (ready) => {
      if (this.#active) {
        this.connected = ready === true;
      }
    }),
    onPluginEvent('haptics', 'ready', () => void this.#refreshTablet().catch(console.warn)),
    onPluginEvent('haptics', 'connection-error', (failure) => {
      if (this.#active && typeof failure === 'string') {
        toast.error(failure);
      }
    }),
  ];

  constructor() {
    void Promise.all(this.#listeners)
      .then(() => this.#refreshTablet())
      .catch(console.warn);
    loadSettings()
      .then((saved) => {
        if (this.#active) {
          this.settings = saved;
          this.loaded = true;
        }
      })
      .catch(() => toast.error('Android settings unavailable'));
  }

  async #refreshTablet() {
    const ready = await tabletReady();
    if (this.#active) {
      this.connected = ready;
    }
  }

  /** Changes apply in order; each one builds on the settings the previous one saved. */
  apply = (change: Partial<HapticsSettings>) => {
    // Choice has no disabled state; saving before the file was read would overwrite it with defaults.
    if (!this.loaded) {
      return Promise.resolve();
    }
    this.#queue = this.#queue.then(() => this.#save(change));
    return this.#queue;
  };

  async #save(change: Partial<HapticsSettings>) {
    this.saving = true;
    const next = normalizeSettings({ ...this.settings, ...change });
    try {
      await saveSettings(next);
      this.settings = next;
    } catch (error) {
      console.error(error);
      toast.error('Could not save Android settings');
      this.saving = false;
      return;
    }
    try {
      this.connected = await configureHaptics(toConfig(next));
      if (next.enabled && !this.connected) {
        toast.error('No tablet found');
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not apply Android settings');
    } finally {
      this.saving = false;
    }
  }

  async launch() {
    this.launching = true;
    try {
      await launchArtemis();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not launch Artemis');
    } finally {
      this.launching = false;
    }
  }

  destroy() {
    this.#active = false;
    for (const listener of this.#listeners) {
      void listener.then((stop) => stop()).catch(console.warn);
    }
  }
}
