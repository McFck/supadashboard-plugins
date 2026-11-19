import type { Curve, Section, TrainProfile } from './manifest';
import { between, type Random } from './random';

export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export const fromDb = (db: number) => 10 ** (db / 20);

/** Beyond the ends the outer segment extends; the 13000 pack's pitch curves stop short of the top speed. */
export function curve(points: Curve, x: number): number {
  if (!points.length) return 0;
  if (points.length === 1) return points[0][1];
  let index = 0;
  while (index < points.length - 2 && points[index + 1][0] < x) index++;
  const [x0, y0] = points[index];
  const [x1, y1] = points[index + 1];
  return x1 === x0 ? y1 : Math.max(0, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
}

export function rollingLevels(speedKmh: number) {
  const fraction = clamp(speedKmh / 60, 0, 1.2);
  const fadeIn = clamp((speedKmh - 1) / 6, 0, 1);
  return {
    gain: fraction * fadeIn,
    rate: 0.85 + 0.25 * fraction,
    cutoff: 700 * (6000 / 700) ** clamp((speedKmh - 5) / 55, 0, 1),
  };
}

export interface Effort {
  power: number;
  brake: number;
}

/** Seconds for a full 0..1 effort change. */
const EFFORT_SECONDS = 0.6;

export function slewEffort(current: Effort, target: Effort, seconds: number): Effort {
  const step = clamp(seconds, 0, 0.25) / EFFORT_SECONDS;
  const move = (from: number, to: number) =>
    Math.abs(to - from) <= step + 1e-9 ? to : from + Math.sign(to - from) * step;
  if (target.brake > 0 && current.power > 0) return { power: move(current.power, 0), brake: 0 };
  if (target.power > 0 && current.brake > 0) return { power: 0, brake: move(current.brake, 0) };
  return { power: move(current.power, target.power), brake: move(current.brake, target.brake) };
}

/** Portals are keyed in line order and mirrored for the other direction. */
export function sectionAt(
  sections: TrainProfile['sections'],
  from: string,
  to: string,
  progress: number,
): Section {
  const of = (code: string) => sections.stations[code] ?? sections.default;
  if (!to || from === to) return of(from);
  const forward = sections.portals[`${from}-${to}`];
  const backward = sections.portals[`${to}-${from}`];
  const crossing = forward ?? (backward === undefined ? 0.5 : 1 - backward);
  return progress < crossing ? of(from) : of(to);
}

export interface HvacStep {
  at: number;
  running: boolean;
}

export function hvacSteps(
  random: Random,
  from: number,
  until: number,
  cycle: readonly [number, number],
): HvacStep[] {
  const steps: HvacStep[] = [];
  let at = from;
  let running = random() < 0.6;
  while (at < until) {
    steps.push({ at, running });
    const share = running ? 0.6 : 0.4;
    at += between(random, cycle[0], cycle[1]) * share;
    running = !running;
  }
  return steps;
}
