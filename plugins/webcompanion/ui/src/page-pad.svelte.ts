import type { PluginBrowserScrollFrame } from '@supadashboard/kit';
import { ScrollGesture } from './scroll-gesture';

export class PagePadController {
  private readonly life = new AbortController();
  private readonly scroll: ScrollGesture;
  private pointer: number | undefined;

  constructor(
    private element: HTMLElement,
    send: (frame: PluginBrowserScrollFrame) => boolean,
  ) {
    this.scroll = new ScrollGesture(send);
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
    if (
      this.pointer === undefined &&
      event.isPrimary &&
      event.button === 0 &&
      this.scroll.start(event.clientX, event.clientY, event.timeStamp)
    ) {
      this.pointer = event.pointerId;
      this.element.setPointerCapture(event.pointerId);
    }
  };

  private move = (event: PointerEvent) => {
    if (this.pointer === event.pointerId) {
      const coalesced = event.getCoalescedEvents?.();
      for (const { clientX, clientY, timeStamp } of coalesced?.length ? coalesced : [event]) {
        this.scroll.move(clientX, clientY, timeStamp);
      }
    }
  };

  private up = (event: PointerEvent) => {
    if (this.pointer === event.pointerId) {
      this.finish(event.timeStamp);
    }
  };

  private cancel = (event: PointerEvent) => {
    if (this.pointer === event.pointerId) {
      this.finish();
    }
  };

  private finish(time?: number) {
    const pointer = this.pointer;
    this.pointer = undefined;
    this.scroll.finish(time);
    if (pointer !== undefined && this.element.hasPointerCapture(pointer)) {
      this.element.releasePointerCapture(pointer);
    }
  }
}
