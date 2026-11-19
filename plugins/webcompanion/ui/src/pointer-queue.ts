import type { PluginBrowserAction } from '@supadashboard/kit';
import { clamp } from './gesture';

export type PointerAction = Extract<PluginBrowserAction, { kind: 'pointer' }>;
type Input = PointerAction['input'];

/** Sends pointer input one action at a time; moves that pile up behind a slow reply merge into one. */
export class PointerQueue {
  private readonly queue: PointerAction[] = [];
  private busy = false;

  constructor(private send: (action: PointerAction) => Promise<boolean>) {}

  push(tab: number, input: Input) {
    const previous = this.queue.at(-1);
    if (
      'dx' in input &&
      previous?.tab === tab &&
      'dx' in previous.input &&
      input.kind === previous.input.kind
    ) {
      previous.input.dx = clamp(previous.input.dx + input.dx, 2048);
      previous.input.dy = clamp(previous.input.dy + input.dy, 2048);
    } else {
      this.queue.push({ kind: 'pointer', tab, input });
    }
    void this.flush();
  }

  /** Drops queued input. A held button, or a release that never went out, still gets one cancel. */
  cancel(tab: number | null, pressed: boolean) {
    const release =
      pressed || this.queue.some(({ input }) => input.kind === 'up' || input.kind === 'cancel');
    this.queue.length = 0;
    if (release && tab !== null) {
      this.push(tab, { kind: 'cancel' });
    }
  }

  private async flush() {
    if (this.busy) {
      return;
    }
    const action = this.queue.shift();
    if (!action) {
      return;
    }
    this.busy = true;
    try {
      await this.send(action);
    } finally {
      this.busy = false;
      if (this.queue.length) {
        void this.flush();
      }
    }
  }
}
