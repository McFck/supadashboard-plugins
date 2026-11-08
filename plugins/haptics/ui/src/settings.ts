// The plugin's own settings: a store file of its own, so settings.json is untouched.
import { load, type Store } from '@tauri-apps/plugin-store';
import { storeIsReadable } from '@supadashboard/kit';
import { STRENGTHS, type HapticsConfig, type Strength } from './haptics';

export type HapticsSettings = {
  enabled: boolean;
  pressPulse: boolean;
  adbPath: string;
  serial: string;
  strength: Strength;
  lockWithPc: boolean;
};

const KEY = 'settings';
export const DEFAULTS: HapticsSettings = {
  enabled: false,
  pressPulse: true,
  adbPath: '',
  serial: '',
  strength: 'medium',
  lockWithPc: false,
};

export function normalizeSettings(raw: unknown): HapticsSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<HapticsSettings>) : {};
  const text = (field: unknown) => (typeof field === 'string' ? field.trim().slice(0, 1024) : '');
  return {
    enabled: value.enabled === true,
    pressPulse: value.pressPulse !== false,
    adbPath: text(value.adbPath),
    serial: text(value.serial),
    // Files saved before strength existed read as the default.
    strength: STRENGTHS.find((strength) => strength === value.strength) ?? DEFAULTS.strength,
    lockWithPc: value.lockWithPc === true,
  };
}

export const toConfig = (s: HapticsSettings): HapticsConfig => ({
  enabled: s.enabled,
  adbPath: s.adbPath || undefined,
  serial: s.serial || undefined,
  strength: s.strength,
  lockWithPc: s.lockWithPc,
});

async function openStore(): Promise<Store> {
  const store = await load('haptics.json', { defaults: {}, autoSave: false });
  // An unparseable file opens as empty, and saving would replace what the user had.
  if (!(await storeIsReadable(store))) {
    throw new Error('Haptics settings unreadable');
  }
  return store;
}

export async function loadSettings() {
  return normalizeSettings(await (await openStore()).get(KEY));
}

export async function saveSettings(settings: HapticsSettings) {
  const store = await openStore();
  await store.set(KEY, settings);
  await store.save();
}

/** Calls back when another window saves. */
export async function watchSettings(onChange: (settings: HapticsSettings) => void) {
  return (await openStore()).onKeyChange(KEY, (raw) => onChange(normalizeSettings(raw)));
}
