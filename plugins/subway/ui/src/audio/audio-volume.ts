import { get } from 'svelte/store';
import {
  registerLocalVolumeChannel,
  requestRuntime,
  runtimeView,
  type PluginApi,
  type RuntimeSnapshot,
} from '@supadashboard/kit';

export const SUBWAY_MIX_TARGET = 'subway:immersion';
export const SUBWAY_MIX_VOLUME_ID = 'subway.mixVolume';
export const SUBWAY_MIX_MUTED_ID = 'subway.mixMuted';

export type SubwayMixerSettings = { volume: number; muted: boolean };

function clampVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export function readSubwayMixerSettings(
  snapshot: RuntimeSnapshot = get(runtimeView),
): SubwayMixerSettings | null {
  if (!snapshot.online) return null;
  const volume = snapshot.variables.records[SUBWAY_MIX_VOLUME_ID]?.value;
  const muted = snapshot.variables.records[SUBWAY_MIX_MUTED_ID]?.value;
  if (typeof volume !== 'number' || !Number.isFinite(volume) || typeof muted !== 'boolean')
    return null;
  return { volume: clampVolume(volume), muted };
}

export function subscribeSubwayMixerSettings(
  listener: (settings: SubwayMixerSettings) => void,
): () => void {
  return runtimeView.subscribe((snapshot) => {
    const settings = readSubwayMixerSettings(snapshot);
    if (settings) listener(settings);
  });
}

let activeRegistration: (() => void) | undefined;

export function registerSubwayMixerChannel(api: PluginApi): () => void {
  if (activeRegistration) return activeRegistration;
  const stop = registerLocalVolumeChannel(SUBWAY_MIX_TARGET, {
    label: 'Subway',
    icon: 'TrainFront',
    read: () => readSubwayMixerSettings(),
    setVolume: (value) => writeVariable(api, SUBWAY_MIX_VOLUME_ID, clampVolume(value)),
    setMuted: (muted) => writeVariable(api, SUBWAY_MIX_MUTED_ID, muted),
    subscribe: (listener) => runtimeView.subscribe(() => listener()),
  });
  const cleanup = () => {
    stop();
    if (activeRegistration === cleanup) activeRegistration = undefined;
  };
  activeRegistration = cleanup;
  return cleanup;
}

async function writeVariable(api: PluginApi, id: string, value: number | boolean): Promise<void> {
  const snapshot = get(runtimeView);
  if (!snapshot.online) throw new Error('Subway mixer is unavailable');
  if (snapshot.owner) {
    const updated = await api.setVariable(id, value);
    if (!updated) throw new Error(`Could not update ${id}`);
    return;
  }
  await requestRuntime({ type: 'setVariable', payload: { id, value } });
}

if (import.meta.hot) import.meta.hot.dispose(() => activeRegistration?.());
