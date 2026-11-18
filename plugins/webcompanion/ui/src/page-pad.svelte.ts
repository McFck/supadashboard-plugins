import type { PluginBrowserScrollFrame } from '@supadashboard/kit';

type Point = { x: number; y: number; time: number };
type Drag = { pointer: number; samples: Point[]; last: Point; dx: number; dy: number };

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value));
}

export class PagePadController {
  private readonly life = new AbortController();
  private drag: Drag | undefined;
  private frame = 0;

  constructor(
    private element: HTMLElement,
    private send: (frame: PluginBrowserScrollFrame) => boolean,
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
    this.finish();
  }

  private down = (event: PointerEvent) => {
    if (this.drag || !event.isPrimary || event.button !== 0 || !this.send({ phase: 'hold' })) {
      return;
    }
    const last = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    this.drag = { pointer: event.pointerId, samples: [last], last, dx: 0, dy: 0 };
    this.element.setPointerCapture(event.pointerId);
  };

  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    const coalesced = event.getCoalescedEvents?.();
    for (const { clientX: x, clientY: y, timeStamp: time } of coalesced?.length
      ? coalesced
      : [event]) {
      if (x === drag.last.x && y === drag.last.y) {
        continue;
      }
      drag.dx += drag.last.x - x;
      drag.dy += drag.last.y - y;
      drag.last = { x, y, time };
      drag.samples.push(drag.last);
    }
    drag.samples = drag.samples.filter(({ time }) => drag.last.time - time <= 80);
    if (!this.frame) {
      this.frame = requestAnimationFrame(this.flush);
    }
  };

  private flush = () => {
    this.frame = 0;
    const drag = this.drag;
    if (!drag) {
      return;
    }
    const dx = clamp(Math.trunc(drag.dx), 4096);
    const dy = clamp(Math.trunc(drag.dy), 4096);
    drag.dx -= dx;
    drag.dy -= dy;
    if ((dx || dy) && !this.send({ phase: 'move', dx, dy })) {
      this.clear();
    } else if (Math.abs(drag.dx) >= 1 || Math.abs(drag.dy) >= 1) {
      this.frame = requestAnimationFrame(this.flush);
    }
  };

  private up = (event: PointerEvent) => {
    if (this.drag?.pointer === event.pointerId) {
      this.finish(event.timeStamp);
    }
  };

  private cancel = (event: PointerEvent) => {
    if (this.drag?.pointer === event.pointerId) {
      this.finish();
    }
  };

  private finish(time = Infinity) {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    cancelAnimationFrame(this.frame);
    this.flush();
    if (this.drag) {
      const first = drag.samples[0];
      const dt = first ? drag.last.time - first.time : 0;
      let vx = 0;
      let vy = 0;
      if (first && dt > 0 && time - drag.last.time < 50) {
        vx = clamp(((first.x - drag.last.x) * 1000) / dt, 10_000);
        vy = clamp(((first.y - drag.last.y) * 1000) / dt, 10_000);
        if (Math.hypot(vx, vy) <= 50) {
          vx = 0;
          vy = 0;
        }
      }
      this.send({ phase: 'release', vx, vy });
    }
    this.clear();
  }

  private clear() {
    const drag = this.drag;
    this.drag = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (drag && this.element.hasPointerCapture(drag.pointer)) {
      this.element.releasePointerCapture(drag.pointer);
    }
  }
}
