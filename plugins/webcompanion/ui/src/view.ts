import type { PluginBrowserOutline } from '@supadashboard/kit';

type Target = PluginBrowserOutline['targets'][number];
export type Point = { x: number; y: number };
export type Projection = Point & { scale: number };

export function pickTarget(
  view: PluginBrowserOutline,
  projection: Projection,
  point: Point,
  selected: number | undefined,
) {
  const x = (point.x - projection.x) / projection.scale;
  const y = (point.y - projection.y) / projection.scale;
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) {
    return;
  }

  let nearest: { target: Target; distance: number } | undefined;
  let tied = false;
  for (const target of view.targets) {
    const { rect } = target;
    const dx = Math.max(rect.x - x, 0, x - rect.x - rect.w);
    const dy = Math.max(rect.y - y, 0, y - rect.y - rect.h);
    const distance = Math.hypot(dx, dy) * projection.scale;
    if (distance > 12) {
      continue;
    }
    if (distance === 0 && nearest?.distance === 0) {
      if (target.rect.w * target.rect.h <= nearest.target.rect.w * nearest.target.rect.h) {
        nearest = { target, distance };
      }
    } else if (
      !nearest ||
      distance < nearest.distance - 2 ||
      (distance === 0 && nearest.distance > 0)
    ) {
      nearest = { target, distance };
      tied = false;
    } else if (distance > 0 && Math.abs(distance - nearest.distance) <= 2) {
      if (target.id === selected) {
        nearest = { target, distance };
      }
      tied = nearest.target.id !== selected;
    }
  }

  if (nearest && !tied) {
    return {
      target: nearest.target,
      x: Math.max(
        nearest.target.rect.x,
        Math.min(nearest.target.rect.x + nearest.target.rect.w - 1, Math.floor(x)),
      ),
      y: Math.max(
        nearest.target.rect.y,
        Math.min(nearest.target.rect.y + nearest.target.rect.h - 1, Math.floor(y)),
      ),
    };
  }
}
