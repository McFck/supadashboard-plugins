import type { PluginBrowserScroll } from '@supadashboard/kit';

type Drag = {
  pointer: number;
  last: number;
  samples: { y: number; time: number }[];
};

export class ScrollPadController {
  private readonly life = new AbortController();
  private drag: Drag | undefined;
  private pixels = 0;
  private fling = 0;
  private sending = false;

  constructor(
    private element: HTMLButtonElement,
    private send: (input: PluginBrowserScroll, signal: AbortSignal) => Promise<boolean>,
  ) {
    const options = { signal: this.life.signal };
    element.addEventListener('pointerdown', this.down, options);
    element.addEventListener('pointermove', this.move, options);
    element.addEventListener('pointerup', this.up, options);
    element.addEventListener('pointercancel', this.cancel, options);
    element.addEventListener('lostpointercapture', this.cancel, options);
  }

  destroy() {
    this.life.abort();
  }

  private down = (event: PointerEvent) => {
    if (this.drag || !event.isPrimary || event.button !== 0) {
      return;
    }
    this.fling = 0;
    this.element.setPointerCapture(event.pointerId);
    this.drag = {
      pointer: event.pointerId,
      last: event.clientY,
      samples: [{ y: event.clientY, time: event.timeStamp }],
    };
  };

  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    this.pixels += drag.last - event.clientY;
    drag.last = event.clientY;
    drag.samples.push({ y: event.clientY, time: event.timeStamp });
    drag.samples = drag.samples.filter((sample) => event.timeStamp - sample.time <= 80);
    void this.flush();
  };

  private up = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    this.drag = undefined;
    const first = drag.samples[0];
    const last = drag.samples.at(-1);
    if (first && last && last.time > first.time && event.timeStamp - last.time < 50) {
      const distance = Math.round(((first.y - last.y) / (last.time - first.time)) * 240);
      this.fling = Math.max(-6000, Math.min(6000, distance));
    }
    void this.flush();
  };

  private cancel = (event: PointerEvent) => {
    if (this.drag?.pointer === event.pointerId) {
      this.drag = undefined;
    }
  };

  private async flush() {
    if (this.sending) {
      return;
    }
    this.sending = true;
    const signal = this.life.signal;
    try {
      while (!signal.aborted) {
        const pixels = Math.max(-2048, Math.min(2048, Math.trunc(this.pixels)));
        let input: PluginBrowserScroll;
        if (pixels) {
          this.pixels -= pixels;
          input = { kind: 'drag', pixels };
        } else if (this.fling) {
          input = { kind: 'fling', pixels: this.fling };
          this.fling = 0;
        } else {
          return;
        }
        // One request at a time. Deltas that arrive during the round trip are combined.
        if (!(await this.send(input, signal))) {
          this.drag = undefined;
          this.pixels = 0;
          this.fling = 0;
          return;
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
