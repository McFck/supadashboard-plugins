import type { PluginBrowserScrollFrame } from '@supadashboard/kit';
import { clamp, HOLD_MS, point } from './gesture';
import { PointerQueue, type PointerAction } from './pointer-queue';
import { ScrollGesture, type ScrollInput } from './scroll-gesture';

type Input = PointerAction['input'];
type Point = { x: number; y: number };
type Direction = 'next' | 'previous';
type Gesture =
  | { kind: 'idle' | 'spent' | 'scroll' }
  | { kind: 'aim'; origin: Point }
  | { kind: 'pair'; origin: Point; time: number }
  | { kind: 'swipe'; originX: number; x: number }
  | { kind: 'move' | 'drag'; last: Point };

export class TouchpadController {
  private readonly lifetime = new AbortController();
  private readonly fingers = new Map<number, Point>();
  private readonly pointer: PointerQueue;
  private readonly scroll: ScrollGesture;
  private gesture: Gesture = { kind: 'idle' };
  private tab: number | null = null;
  private hold: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private pad: HTMLElement,
    send: (action: PointerAction) => Promise<boolean>,
    private sendScroll: (frame: PluginBrowserScrollFrame) => boolean,
    private switchTab: (direction: Direction) => void,
  ) {
    this.pointer = new PointerQueue(send);
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
    } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      this.switchTab(event.key === 'ArrowLeft' ? 'previous' : 'next');
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
      if (centre) {
        this.gesture = { kind: 'pair', origin: centre, time: event.timeStamp };
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
    }, HOLD_MS);
  };

  private move = (event: PointerEvent) => {
    if (!this.fingers.has(event.pointerId)) {
      return;
    }
    const gesture = this.gesture;
    const here = point(event);
    this.fingers.set(event.pointerId, here);
    if (gesture.kind === 'pair' || gesture.kind === 'swipe' || gesture.kind === 'scroll') {
      this.movePair(event.timeStamp);
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

  private movePair(time: number) {
    const centre = this.centre();
    if (!centre) {
      return;
    }
    const gesture = this.gesture;
    if (gesture.kind === 'pair') {
      const dx = Math.abs(centre.x - gesture.origin.x);
      const dy = Math.abs(centre.y - gesture.origin.y);
      if (Math.max(dx, dy) < 8) {
        return;
      }
      if (dx > 1.4 * dy) {
        this.gesture = { kind: 'swipe', originX: gesture.origin.x, x: centre.x };
      } else if (this.scroll.start(gesture.origin.x, gesture.origin.y, gesture.time)) {
        this.gesture = { kind: 'scroll' };
        this.scroll.move(centre.x, centre.y, time);
      } else {
        this.gesture = { kind: 'spent' };
      }
    } else if (gesture.kind === 'scroll') {
      this.scroll.move(centre.x, centre.y, time);
    } else if (gesture.kind === 'swipe') {
      gesture.x = centre.x;
    }
  }

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
    } else if (this.gesture.kind === 'swipe') {
      const distance = this.gesture.x - this.gesture.originX;
      if (Math.abs(distance) >= 45) {
        this.switchTab(distance < 0 ? 'next' : 'previous');
      }
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
    const dx = clamp(Math.round((to.x - from.x) * 2), 2048);
    const dy = clamp(Math.round((to.y - from.y) * 2), 2048);
    if (dx || dy) {
      this.command({ kind: 'move', dx, dy });
    }
  }

  private scrollFrame(frame: ScrollInput) {
    return this.tab !== null && this.sendScroll({ ...frame, tab: this.tab });
  }

  private reset() {
    this.scroll.finish();
    clearTimeout(this.hold);
    this.pointer.cancel(this.tab, this.gesture.kind === 'drag');
    this.gesture = { kind: 'idle' };
    const ids = [...this.fingers.keys()];
    this.fingers.clear();
    for (const id of ids) {
      if (this.pad.hasPointerCapture(id)) {
        this.pad.releasePointerCapture(id);
      }
    }
  }

  private command(input: Input) {
    if (this.tab !== null) {
      this.pointer.push(this.tab, input);
    }
  }
}
