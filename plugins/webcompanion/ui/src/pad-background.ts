import type { ControlConfig } from '@supadashboard/kit';

export function padBackground(options: ControlConfig['options']) {
  const color = options?.padBackground;
  if (typeof color === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(color)) {
    return color;
  }
  return '#00000000';
}
