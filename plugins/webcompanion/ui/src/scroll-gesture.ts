import type { PluginBrowserScrollFrame } from '@supadashboard/kit';

type Point = { x: number; y: number; time: number };
type Drag = { samples: Point[]; last: Point; dx: number; dy: number };

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value));
}

export class ScrollGesture {
  private drag: Drag | undefined;
  private frame = 0;

  constructor(private send: (frame: PluginBrowserScrollFrame) => boolean) {}

  start(x: number, y: number, time: number) {
    if (!this.send({ phase: 'hold' })) {
      return false;
    }
    const last = { x, y, time };
    this.drag = { samples: [last], last, dx: 0, dy: 0 };
    return true;
  }

  move(x: number, y: number, time: number) {
    const drag = this.drag;
    if (!drag || (x === drag.last.x && y === drag.last.y)) {
      return;
    }
    drag.dx += drag.last.x - x;
    drag.dy += drag.last.y - y;
    drag.last = { x, y, time };
    drag.samples.push(drag.last);
    drag.samples = drag.samples.filter((sample) => time - sample.time <= 80);
    if (!this.frame) {
      this.frame = requestAnimationFrame(this.flush);
    }
  }

  finish(time = Infinity) {
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

  private clear() {
    this.drag = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
