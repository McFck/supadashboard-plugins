// Pulse length and the rate limit: a flick must not queue seconds of buzzing.
import type { PulseKind, Strength } from './haptics';

/** Pause after a pulse; the motor needs it to spin down and `cmd` needs time to start. */
const GAP_MS = 25;

const BASE: Record<PulseKind, number> = { tick: 25, tap: 40, confirm: 70 };
// The Galaxy Tab's coin motor has no amplitude control, so strength scales the length.
const SCALE: Record<Strength, number> = { light: 0.6, medium: 1, strong: 1.6 };

export const pulseMillis = (kind: PulseKind, strength: Strength) =>
  Math.round(BASE[kind] * SCALE[strength]);

/** Drops a pulse while the previous one is still playing. */
export class Limiter {
  private freeAt = 0;

  admit(now: number, ms: number) {
    if (now < this.freeAt) {
      return false;
    }
    this.freeAt = now + ms + GAP_MS;
    return true;
  }
}
