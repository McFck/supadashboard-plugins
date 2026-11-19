import type { PluginBrowserAction } from '@supadashboard/kit';

type Move = Extract<PluginBrowserAction, { kind: 'move_tab' }>;
type Point = { x: number; y: number };
export type Item = { id: number; lane: string; node: HTMLElement };
export type Drop = Pick<Move, 'anchor' | 'side'> & { axis: 'x' | 'y' };

const row = '[data-tab-id]';

export function item(node: Element | null): Item | undefined {
  const tile = node?.closest(row);
  if (tile instanceof HTMLElement && tile.dataset.tabId && tile.dataset.tabLane) {
    return { id: Number(tile.dataset.tabId), lane: tile.dataset.tabLane, node: tile };
  }
}

export function laneOf(viewport: HTMLElement, source: Item) {
  return [...viewport.querySelectorAll(row)].flatMap((node) => {
    const tab = item(node);
    return tab?.lane === source.lane ? [tab] : [];
  });
}

function insertion(tab: Item, { x, y }: Point, horizontal: boolean, edge?: Move['side']): Drop {
  const box = tab.node.getBoundingClientRect();
  const parent = tab.node.parentElement;
  const singleRow = parent && !getComputedStyle(parent).gridTemplateRows.trim().includes(' ');
  const axis = horizontal && singleRow ? 'x' : 'y';
  const before = axis === 'x' ? x < box.left + box.width / 2 : y < box.top + box.height / 2;
  return { anchor: tab.id, axis, side: edge ?? (before ? 'before' : 'after') };
}

function nearest(lane: Item[], point: Point, viewport: DOMRect, horizontal: boolean) {
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
    if (horizontal && tab === lane[0] && point.x < left) {
      return insertion(tab, point, horizontal, 'before');
    }
    if (horizontal && tab === lane.at(-1) && point.x >= right) {
      return insertion(tab, point, horizontal, 'after');
    }
    const dx = Math.max(0, left - point.x, point.x - right);
    const dy = Math.max(0, top - point.y, point.y - bottom);
    const gap = dx ** 2 + dy ** 2;
    if (gap < distance) {
      target = tab;
      distance = gap;
    }
  }
  return target && insertion(target, point, horizontal);
}

/** Where `source` would land if dropped at `point`; undefined outside its lane or the viewport. */
export function dropAt(viewport: HTMLElement, source: Item, point: Point, horizontal: boolean) {
  const bounds = viewport.getBoundingClientRect();
  const { x, y } = point;
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) {
    return undefined;
  }
  const hit = document.elementFromPoint(x, y);
  if (!viewport.contains(hit)) {
    return undefined;
  }
  const hovered = item(hit);
  if (hovered && hovered.lane !== source.lane) {
    return undefined;
  }
  const drop = hovered
    ? insertion(hovered, point, horizontal)
    : nearest(laneOf(viewport, source), point, bounds, horizontal);
  return drop?.anchor === source.id ? undefined : drop;
}
