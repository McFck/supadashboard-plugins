import { isTauri } from '@tauri-apps/api/core';
import { callPlugin } from '@supadashboard/kit';

export const PULSE_KINDS = ['tick', 'tap', 'confirm'] as const;
export type PulseKind = (typeof PULSE_KINDS)[number];

/** Scales pulse lengths natively; the tablet's motor has no amplitude control. */
export const STRENGTHS = ['light', 'medium', 'strong'] as const;
export type Strength = (typeof STRENGTHS)[number];

export type HapticsConfig = {
  enabled: boolean;
  adbPath?: string;
  serial?: string;
  strength: Strength;
  /** Turns the tablet's screen off when the PC sleeps or shuts down. */
  lockWithPc: boolean;
};

/** Applies the settings natively; true when a tablet is connected. */
export async function configureHaptics(config: HapticsConfig) {
  return isTauri() && (await callPlugin('haptics', 'configure', config)) === true;
}

export function pulse(kind: PulseKind) {
  if (isTauri()) {
    // Best effort: a missed buzz is not worth a toast.
    callPlugin('haptics', 'pulse', { kind }).catch(() => {});
  }
}
