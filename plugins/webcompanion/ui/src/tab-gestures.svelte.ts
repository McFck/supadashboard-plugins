import { KineticScroll, type PluginBrowserAction } from '@supadashboard/kit';

type Move = Extract<PluginBrowserAction, { kind: 'move_tab' }>;
type Point = { x: number; y: number };
type Item = { id: number; lane: string; node: HTMLElement };
type Drop = Pick<Move, 'anchor' | 'side'> & { axis: 'x' | 'y' };
type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; id: number; source: Item; origin: Point }
  | { kind: 'reorder'; id: number; source: Item; point: Point };

// Small touch movements during a hold must leave the tab press in place.
const pressSlop = 16;
const row = '[data-tab-id]';
const point = ({ clientX, clientY }: PointerEvent) => ({ x: clientX, y: clientY });

function item(node: Element | null) {
  const tile = node?.closest(row);
  if (tile instanceof HTMLElement && tile.dataset.tabId && tile.dataset.tabLane) {
    return { id: Number(tile.dataset.tabId), lane: tile.dataset.tabLane, node: tile };
  }
}

export class TabGestures {
  dragging = $state<number | null>(null);
  drop = $state<Drop>();
  #gesture: Gesture = { kind: 'idle' };
  #lifetime = new AbortController();
  #scroll: KineticScroll;
  #position = 0;
  #hold: ReturnType<typeof setTimeout> | undefined;
  #frame = 0;
  #suppressClick = false;

  constructor(
    private viewport: HTMLElement,
    track: HTMLElement,
    private horizontal: boolean,
    private send: (action: Move) => void,
  ) {
    this.#scroll = new KineticScroll(
      viewport,
      track,
      {
        onInput() {},
        onRest() {},
        onMove: (value) => {
          this.#position = value;
        },
      },
      { axis: horizontal ? 'x' : 'y', dragThreshold: pressSlop },
    );
    this.#scroll.scrollTo(0, false);
    const options = { capture: true, signal: this.#lifetime.signal };
    viewport.addEventListener('pointerdown', this.#down, options);
    viewport.addEventListener('pointermove', this.#move, options);
    viewport.addEventListener('pointerup', this.#up, options);
    viewport.addEventListener('pointercancel', this.#cancel, options);
    viewport.addEventListener('lostpointercapture', this.#lostCapture, options);
    viewport.addEventListener('pointerleave', this.#leave, { signal: this.#lifetime.signal });
    viewport.addEventListener('click', this.#click, options);
    viewport.addEventListener('contextmenu', this.#contextMenu, options);
    viewport.addEventListener('focusin', this.#focus, options);
  }

  destroy() {
    this.#lifetime.abort();
    this.#reset();
    this.#scroll.destroy();
  }

  key(event: KeyboardEvent) {
    if (!event.altKey || !(event.target instanceof Element)) {
      return;
    }
    const previous = this.horizontal ? 'ArrowLeft' : 'ArrowUp';
    const next = this.horizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== previous && event.key !== next) {
      return;
    }
    const source = item(event.target);
    if (!source) {
      return;
    }
    event.preventDefault();
    const lane = this.#lane(source);
    const forward = event.key === next;
    const target = lane[lane.findIndex(({ id }) => id === source.id) + (forward ? 1 : -1)];
    if (target) {
      this.send({
        kind: 'move_tab',
        tab: source.id,
        anchor: target.id,
        side: forward ? 'after' : 'before',
      });
    }
  }

  #down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) {
      return;
    }
    this.#reset();
    this.#suppressClick = false;
    const source = item(event.target.closest('[data-tab-select]'));
    if (!source) {
      return;
    }
    const press: Extract<Gesture, { kind: 'press' }> = {
      kind: 'press',
      id: event.pointerId,
      source,
      origin: point(event),
    };
    this.#gesture = press;
    this.#hold = setTimeout(() => {
      if (this.#gesture === press && source.node.isConnected) {
        this.#scroll.scrollTo(this.#position, false);
        this.viewport.setPointerCapture(event.pointerId);
        this.#gesture = { kind: 'reorder', id: press.id, source, point: press.origin };
        this.dragging = source.id;
        this.#suppressClick = true;
      }
    }, 400);
  };

  #move = (event: PointerEvent) => {
    const gesture = this.#gesture;
    if (gesture.kind === 'idle' || gesture.id !== event.pointerId) {
      return;
    }
    const position = point(event);
    if (gesture.kind === 'press') {
      if (
        Math.max(
          Math.abs(position.x - gesture.origin.x),
          Math.abs(position.y - gesture.origin.y),
        ) >= pressSlop
      ) {
        this.#reset();
      }
      return;
    }
    gesture.point = position;
    this.#locate(gesture);
    if (!this.#frame) {
      this.#frame = requestAnimationFrame(this.#edgeScroll);
    }
  };

  #locate(gesture: Extract<Gesture, { kind: 'reorder' }>) {
    const {
      source,
      point: { x, y },
    } = gesture;
    const viewport = this.viewport.getBoundingClientRect();
    if (x < viewport.left || x >= viewport.right || y < viewport.top || y >= viewport.bottom) {
      this.drop = undefined;
      return;
    }
    const hit = document.elementFromPoint(x, y);
    if (!this.viewport.contains(hit)) {
      this.drop = undefined;
      return;
    }
    const hovered = item(hit);
    const drop = hovered
      ? this.#insertion(hovered, gesture.point)
      : this.#nearest(gesture, viewport);
    if (!drop || drop.anchor === source.id || (hovered && hovered.lane !== source.lane)) {
      this.drop = undefined;
    } else if (
      this.drop?.anchor !== drop.anchor ||
      this.drop.side !== drop.side ||
      this.drop.axis !== drop.axis
    ) {
      this.drop = drop;
    }
  }

  #insertion(tab: Item, { x, y }: Point, edge?: Move['side']): Drop {
    const box = tab.node.getBoundingClientRect();
    const parent = tab.node.parentElement;
    const singleRow = parent && !getComputedStyle(parent).gridTemplateRows.trim().includes(' ');
    const axis = this.horizontal && singleRow ? 'x' : 'y';
    const before = axis === 'x' ? x < box.left + box.width / 2 : y < box.top + box.height / 2;
    return { anchor: tab.id, axis, side: edge ?? (before ? 'before' : 'after') };
  }

  #lane(source: Item) {
    return [...this.viewport.querySelectorAll(row)].flatMap((node) => {
      const tab = item(node);
      return tab?.lane === source.lane ? [tab] : [];
    });
  }

  #nearest({ source, point: { x, y } }: Extract<Gesture, { kind: 'reorder' }>, viewport: DOMRect) {
    const lane = this.#lane(source);
    let target: Item | undefined;
    let distance = Infinity;
    for (const tab of lane) {
      const box = tab.node.getBoundingClientRect();
      const left = Math.max(box.left, viewport.left);
      const right = Math.min(box.right, viewport.right);
      const top = Math.max(box.top, viewport.top);
      const bottom = Math.min(box.bottom, viewport.bottom);
      if (right <= left || bottom <= top) {
        continue;
      }
      if (this.horizontal && tab === lane[0] && x < left) {
        return this.#insertion(tab, { x, y }, 'before');
      }
      if (this.horizontal && tab === lane.at(-1) && x >= right) {
        return this.#insertion(tab, { x, y }, 'after');
      }
      const dx = Math.max(0, left - x, x - right);
      const dy = Math.max(0, top - y, y - bottom);
      const gap = dx ** 2 + dy ** 2;
      if (gap < distance) {
        target = tab;
        distance = gap;
      }
    }
    return target && this.#insertion(target, { x, y });
  }

  #edgeScroll = () => {
    this.#frame = 0;
    const gesture = this.#gesture;
    if (gesture.kind !== 'reorder') {
      return;
    }
    const box = this.viewport.getBoundingClientRect();
    const position = this.horizontal ? gesture.point.x - box.left : gesture.point.y - box.top;
    const length = this.horizontal ? box.width : box.height;
    const edge = Math.min(length / 4, 32);
    const delta = Math.max(0, position - length + edge) - Math.max(0, edge - position);
    if (delta === 0 || position < 0 || position > length) {
      return;
    }
    const previous = this.#position;
    this.#scroll.scrollTo(previous + delta / 3, false);
    if (this.#position !== previous) {
      this.#locate(gesture);
      this.#frame = requestAnimationFrame(this.#edgeScroll);
    }
  };

  #up = (event: PointerEvent) => {
    const gesture = this.#gesture;
    if (gesture.kind === 'idle' || gesture.id !== event.pointerId) {
      return;
    }
    if (gesture.kind === 'reorder' && this.drop && gesture.source.node.isConnected) {
      const { anchor, side } = this.drop;
      this.send({ kind: 'move_tab', tab: gesture.source.id, anchor, side });
    }
    this.#reset();
  };

  #cancel = (event: PointerEvent) => {
    if (this.#gesture.kind !== 'idle' && this.#gesture.id === event.pointerId) {
      this.#reset();
    }
  };

  #leave = (event: PointerEvent) => {
    if (this.#gesture.kind === 'press') {
      this.#cancel(event);
    }
  };

  #lostCapture = (event: PointerEvent) => {
    if (event.target === this.viewport) {
      this.#cancel(event);
    }
  };

  #reset() {
    clearTimeout(this.#hold);
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#gesture = { kind: 'idle' };
    this.dragging = null;
    this.drop = undefined;
  }

  #click = (event: MouseEvent) => {
    if (this.#suppressClick && event.detail > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  #contextMenu = (event: MouseEvent) => {
    if (this.#gesture.kind !== 'idle') {
      event.preventDefault();
    }
  };

  #focus = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement) || this.#gesture.kind !== 'idle') {
      return;
    }
    const box = this.viewport.getBoundingClientRect();
    const child = event.target.getBoundingClientRect();
    const leading = this.horizontal ? child.left - box.left : child.top - box.top;
    const trailing = this.horizontal ? child.right - box.right : child.bottom - box.bottom;
    if (leading < 0 || trailing > 0) {
      this.#scroll.scrollTo(this.#position + Math.min(0, leading) + Math.max(0, trailing), false);
    }
  };
}
