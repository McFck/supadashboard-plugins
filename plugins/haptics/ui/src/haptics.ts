import { isTauri } from '@tauri-apps/api/core';
import { callPlugin } from '@supadashboard/kit';

export const PULSE_KINDS = ['tick', 'tap', 'confirm'] as const;
export type PulseKind = (typeof PULSE_KINDS)[number];
export const isPulseKind = (value: unknown): value is PulseKind =>
  PULSE_KINDS.some((kind) => kind === value);

export const STRENGTHS = ['light', 'medium', 'strong'] as const;
export type Strength = (typeof STRENGTHS)[number];

export type HapticsConfig = {
  enabled: boolean;
  adbPath?: string;
  serial?: string;
  strength: Strength;
  /** Turns the tablet's screen off when the PC sleeps or shuts down. */
  lockWithPc: boolean;
  artemis: boolean;
  artemisHost: string;
  artemisApp: string;
  usbTethering: boolean;
};

/** True when a tablet is connected. */
export async function configureHaptics(config: HapticsConfig) {
  return isTauri() && (await callPlugin('haptics', 'configure', config)) === true;
}

export async function tabletReady() {
  return isTauri() && (await callPlugin('haptics', 'tabletReady')) === true;
}

export async function launchArtemis() {
  await callPlugin('haptics', 'launchArtemis');
}

export function pulse(kind: PulseKind) {
  if (isTauri()) {
    // Best effort: a missed buzz is not worth a toast.
    callPlugin('haptics', 'pulse', { kind }).catch(() => {});
  }
}
