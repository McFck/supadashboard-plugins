import type { PluginBrowserAction, PluginBrowserScrollFrame } from '@supadashboard/kit';
import { ScrollGesture } from './scroll-gesture';

type Action = Extract<PluginBrowserAction, { kind: 'pointer' }>;
type Input = Action['input'];
type Point = { x: number; y: number };
type Gesture =
  | { kind: 'idle' | 'spent' | 'scroll' }
  | { kind: 'aim'; origin: Point }
  | { kind: 'move' | 'drag'; last: Point };

const bounded = (delta: number) => Math.max(-2048, Math.min(2048, delta));
const point = ({ clientX, clientY }: PointerEvent) => ({ x: clientX, y: clientY });

export class TouchpadController {
  private readonly lifetime = new AbortController();
  private readonly fingers = new Map<number, Point>();
  private readonly queue: Action[] = [];
  private readonly scroll: ScrollGesture;
  private gesture: Gesture = { kind: 'idle' };
  private tab: number | null = null;
  private hold: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private busy = false;

  constructor(
    private pad: HTMLElement,
    private send: (action: Action) => Promise<boolean>,
    private sendScroll: (frame: PluginBrowserScrollFrame) => boolean,
  ) {
    this.scroll = new ScrollGesture((frame) => this.scrollFrame(frame));
    const options = { signal: this.lifetime.signal };
    pad.addEventListener('pointerdown', this.down, options);
    pad.addEventListener('pointermove', this.move, options);
    pad.addEventListener('pointerup', this.up, options);
    pad.addEventListener('pointercancel', this.cancel, options);
    pad.addEventListener('lostpointercapture', this.cancel, options);
  }

  setTab(tab: number | null) {
    if (this.tab !== tab) {
      this.reset();
      this.tab = tab;
    }
  }

  destroy() {
    this.lifetime.abort();
    this.reset();
    this.tab = null;
  }

  key(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 12;
    const direction = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key === 'Escape') {
      this.reset();
    } else {
      const delta = Object.entries(direction).find(([key]) => key === event.key)?.[1];
      if (delta) {
        event.preventDefault();
        this.command({ kind: 'begin' });
        this.command({ kind: 'move', dx: delta[0], dy: delta[1] });
      }
    }
  }

  click() {
    this.command({ kind: 'begin' });
    this.command({ kind: 'click' });
  }

  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.tab === null || this.fingers.size >= 2) {
      return;
    }
    event.preventDefault();
    this.pad.setPointerCapture(event.pointerId);
    const here = point(event);
    this.fingers.set(event.pointerId, here);
    if (this.fingers.size === 2) {
      clearTimeout(this.hold);
      if (this.gesture.kind === 'drag') {
        this.command({ kind: 'up' });
      }
      const centre = this.centre();
      if (centre && this.scroll.start(centre.x, centre.y, event.timeStamp)) {
        this.gesture = { kind: 'scroll' };
      } else {
        this.gesture = { kind: 'spent' };
      }
      return;
    }
    this.gesture = { kind: 'aim', origin: here };
    this.scrollFrame({ phase: 'hold' });
    this.command({ kind: 'begin' });
    this.hold = setTimeout(() => {
      if (this.gesture.kind === 'aim') {
        this.gesture = { kind: 'drag', last: this.gesture.origin };
        this.command({ kind: 'down' });
      }
    }, 400);
  };

  private move = (event: PointerEvent) => {
    if (!this.fingers.has(event.pointerId)) {
      return;
    }
    const gesture = this.gesture;
    const here = point(event);
    this.fingers.set(event.pointerId, here);
    if (gesture.kind === 'scroll') {
      const centre = this.centre();
      if (centre) {
        this.scroll.move(centre.x, centre.y, event.timeStamp);
      }
    } else if (
      gesture.kind === 'aim' &&
      Math.hypot(here.x - gesture.origin.x, here.y - gesture.origin.y) >= 6
    ) {
      clearTimeout(this.hold);
      this.motion(gesture.origin, here);
      this.gesture = { kind: 'move', last: here };
    } else if (gesture.kind === 'move' || gesture.kind === 'drag') {
      this.motion(gesture.last, here);
      gesture.last = here;
    }
  };

  private up = (event: PointerEvent) => {
    if (!this.fingers.has(event.pointerId)) {
      return;
    }
    this.move(event);
    clearTimeout(this.hold);
    this.fingers.delete(event.pointerId);
    if (this.gesture.kind === 'aim') {
      this.command({ kind: 'click' });
    } else if (this.gesture.kind === 'drag') {
      this.command({ kind: 'up' });
    } else if (this.gesture.kind === 'scroll') {
      this.scroll.finish(event.timeStamp);
    }
    this.gesture = this.fingers.size ? { kind: 'spent' } : { kind: 'idle' };
  };

  private cancel = (event: PointerEvent) => {
    if (this.fingers.has(event.pointerId)) {
      this.reset();
    }
  };

  private centre() {
    const [a, b] = this.fingers.values();
    if (a && b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }

  private motion(from: Point, to: Point) {
    const dx = bounded(Math.round((to.x - from.x) * 2));
    const dy = bounded(Math.round((to.y - from.y) * 2));
    if (dx || dy) {
      this.command({ kind: 'move', dx, dy });
    }
  }

  private scrollFrame(frame: PluginBrowserScrollFrame) {
    return this.tab !== null && this.sendScroll({ ...frame, tab: this.tab });
  }

  private reset() {
    this.scroll.finish();
    clearTimeout(this.hold);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const needsRelease =
      this.gesture.kind === 'drag' ||
      this.queue.some(({ input }) => input.kind === 'up' || input.kind === 'cancel');
    this.gesture = { kind: 'idle' };
    const ids = [...this.fingers.keys()];
    this.fingers.clear();
    for (const id of ids) {
      if (this.pad.hasPointerCapture(id)) {
        this.pad.releasePointerCapture(id);
      }
    }
    this.queue.length = 0;
    if (needsRelease && this.tab !== null) {
      this.queue.push({ kind: 'pointer', tab: this.tab, input: { kind: 'cancel' } });
      void this.flush();
    }
  }

  private command(input: Input) {
    if (this.tab === null) {
      return;
    }
    const previous = this.queue.at(-1);
    if (
      'dx' in input &&
      previous?.tab === this.tab &&
      'dx' in previous.input &&
      input.kind === previous.input.kind
    ) {
      previous.input.dx = bounded(previous.input.dx + input.dx);
      previous.input.dy = bounded(previous.input.dy + input.dy);
    } else {
      this.queue.push({ kind: 'pointer', tab: this.tab, input });
    }
    this.schedule();
  }

  private schedule() {
    if (!this.frame && !this.busy) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        void this.flush();
      });
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
      if (this.queue[0]?.input.kind === 'cancel') {
        void this.flush();
      } else if (this.queue.length) {
        this.schedule();
      }
    }
  }
}
