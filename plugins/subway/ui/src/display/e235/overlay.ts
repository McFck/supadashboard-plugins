import type { ScreenSchedule } from '../../rendering/screens';
import { detailedMarker } from './detailed-map';
import { routeMapMarker } from './route-map';

/** Animated overlay for the current page; returns true while it needs more frames. */
export function drawE235Overlay(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  time: number,
): boolean {
  if (model.page === 'broad') {
    routeMapMarker(ctx, model, time);
    return true;
  }
  if (model.page === 'nearby') {
    detailedMarker(ctx, model, time);
    return true;
  }
  return false;
}
