import type {
  PluginBrowserAction,
  PluginBrowserOutline,
  PluginBrowserSelection,
} from '@supadashboard/kit';
import { pickTarget, type Point, type Projection } from './view';

type Target = PluginBrowserOutline['targets'][number];
type OutlineInput = Extract<
  Extract<PluginBrowserAction, { kind: 'page' }>['input'],
  { selection: PluginBrowserSelection }
>;
type Candidate = { selection: PluginBrowserSelection; target: Target; since: number };
type Host = {
  command: (input: OutlineInput) => Promise<boolean>;
  stopScroll: () => void;
};

export class ViewTouchController {
  projection = $state<Projection>({ x: 0, y: 0, scale: 1 });
  zoom = $state(1);
  selected = $state<number>();
  private view: PluginBrowserOutline | undefined;
  private readonly life = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly pointers = new Map<number, Point>();
  private pinching = false;
  private pinch: { distance: number; base: number; anchor: Point } | undefined;
  private chosen: Candidate | undefined;
  private armed: Candidate | undefined;
  private busy = false;
  private pressing: Promise<boolean> | undefined;
  private release: { candidate: Candidate; background: boolean } | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private element: HTMLElement,
    private host: Host,
  ) {
    this.observer = new ResizeObserver(this.resetZoom);
    this.observer.observe(element);
    const options = { signal: this.life.signal };
    element.addEventListener('pointerdown', this.down, options);
    element.addEventListener('pointermove', this.move, options);
    element.addEventListener('pointerup', this.up, options);
    element.addEventListener('pointercancel', this.cancelPointer, options);
    element.addEventListener('lostpointercapture', this.cancelPointer, options);
  }

  setView(view: PluginBrowserOutline | undefined) {
    const old = this.view;
    this.view = view;
    if (
      old?.doc !== view?.doc ||
      old?.tab !== view?.tab ||
      old?.width !== view?.width ||
      old?.height !== view?.height
    ) {
      this.cancelSelection();
      for (const id of this.pointers.keys()) {
        this.removePointer(id);
        if (this.element.hasPointerCapture(id)) {
          this.element.releasePointerCapture(id);
        }
      }
      this.resetZoom();
    } else if (
      view?.moving ||
      (this.chosen && !view?.targets.some(({ id }) => id === this.chosen?.target.id))
    ) {
      this.cancelSelection();
    }
  }

  resetZoom = () => {
    this.applyZoom(1, { x: 0, y: 0 }, { x: 0, y: 0 });
  };

  destroy() {
    this.life.abort();
    this.observer.disconnect();
    this.cancelSelection();
  }

  cancelSelection = () => {
    clearTimeout(this.deadline);
    this.release = undefined;
    this.setCandidate(undefined);
  };

  focus(target: Target) {
    this.choose(
      target,
      target.rect.x + Math.floor(target.rect.w / 2),
      target.rect.y + Math.floor(target.rect.h / 2),
    );
  }

  activate(target: Target) {
    if (this.chosen?.target.id !== target.id) {
      this.focus(target);
    }
    this.finish(false);
  }

  private local(event: PointerEvent): Point {
    const box = this.element.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * this.element.clientWidth) / box.width,
      y: ((event.clientY - box.top) * this.element.clientHeight) / box.height,
    };
  }

  private applyZoom(zoom: number, pivot: Point, anchor: Point) {
    const view = this.view;
    if (!view) {
      return;
    }
    const { clientWidth: width, clientHeight: height } = this.element;
    const scale = Math.min(width / view.width, height / view.height) * zoom;
    if (!scale) {
      return;
    }
    const place = (size: number, scaled: number, coordinate: number) =>
      scaled <= size ? (size - scaled) / 2 : Math.min(0, Math.max(size - scaled, coordinate));
    this.zoom = zoom;
    this.projection = {
      scale,
      x: place(width, view.width * scale, pivot.x - anchor.x * scale),
      y: place(height, view.height * scale, pivot.y - anchor.y * scale),
    };
  }

  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.pointers.size >= 2) {
      return;
    }
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    const point = this.local(event);
    this.pointers.set(event.pointerId, point);
    this.cancelSelection();
    if (this.pointers.size === 2) {
      this.pinching = true;
      this.updatePinch();
    } else if (this.view?.moving) {
      this.host.stopScroll();
      this.pinching = true;
    } else {
      this.pick(point);
    }
  };

  private move = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }
    const point = this.local(event);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 2) {
      this.updatePinch();
    } else if (!this.pinching) {
      this.pick(point);
    }
  };

  private up = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }
    if (!this.pinching) {
      this.pick(this.local(event));
      const candidate = this.chosen;
      this.finish(candidate?.target.kind === 'link' && performance.now() - candidate.since >= 450);
    }
    this.removePointer(event.pointerId);
  };

  private cancelPointer = (event: PointerEvent) => {
    if (this.pointers.has(event.pointerId)) {
      this.cancelSelection();
      this.removePointer(event.pointerId);
    }
  };

  private removePointer(id: number) {
    this.pointers.delete(id);
    this.pinch = undefined;
    if (!this.pointers.size) {
      this.pinching = false;
    }
  }

  private updatePinch() {
    const [a, b] = this.pointers.values();
    if (!a || !b) {
      return;
    }
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const pivot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { x, y, scale } = this.projection;
    this.pinch ??= {
      distance,
      base: this.zoom,
      anchor: { x: (pivot.x - x) / scale, y: (pivot.y - y) / scale },
    };
    this.applyZoom(
      Math.min(5, Math.max(1, (this.pinch.base * distance) / this.pinch.distance)),
      pivot,
      this.pinch.anchor,
    );
  }

  private pick(point: Point) {
    const { clientWidth, clientHeight } = this.element;
    const view = this.view;
    if (
      view &&
      !view.moving &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < clientWidth &&
      point.y < clientHeight
    ) {
      const pick = pickTarget(view, this.projection, point, this.chosen?.target.id);
      if (pick) {
        this.choose(pick.target, pick.x, pick.y);
        return;
      }
    }
    this.setCandidate(undefined);
  }

  private choose(target: Target, x: number, y: number) {
    const view = this.view;
    if (!view || view.moving || this.chosen?.target.id === target.id) {
      return;
    }
    this.setCandidate({
      target,
      since: performance.now(),
      selection: {
        tab: view.tab,
        doc: view.doc,
        seq: view.seq,
        target: target.id,
        x,
        y,
        token: crypto.randomUUID().replaceAll('-', ''),
      },
    });
  }

  private setCandidate(candidate: Candidate | undefined) {
    if (this.chosen !== candidate) {
      this.chosen = candidate;
      this.selected = candidate?.target.id;
      void this.syncPreview();
    }
  }

  private finish(background: boolean) {
    if (this.chosen) {
      this.release = { candidate: this.chosen, background };
      if (!this.commit()) {
        this.deadline = setTimeout(this.cancelSelection, 120);
      }
    }
  }

  private commit() {
    const release = this.release;
    if (!release || this.armed !== release.candidate) {
      return false;
    }
    clearTimeout(this.deadline);
    this.release = undefined;
    this.armed = undefined;
    this.chosen = undefined;
    this.selected = undefined;
    this.pressing = this.host.command({
      kind: 'press',
      selection: release.candidate.selection,
      background: release.background,
    });
    return true;
  }

  private async syncPreview() {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      if (this.pressing) {
        await this.pressing;
        this.pressing = undefined;
      }
      while (this.chosen !== this.armed) {
        const candidate = this.chosen;
        const prior = this.armed;
        if (candidate) {
          const ok = await this.host.command({ kind: 'preview', selection: candidate.selection });
          this.armed = ok ? candidate : undefined;
          if (!ok && this.chosen === candidate) {
            this.cancelSelection();
          }
          this.commit();
        } else if (prior) {
          this.armed = undefined;
          await this.host.command({ kind: 'clear_preview', selection: prior.selection });
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
