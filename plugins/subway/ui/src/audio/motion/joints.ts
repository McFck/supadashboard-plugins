import { seeded } from './random';

/** Metres. */
export interface CarGeometry {
  length: number;
  bogieCentres: number;
  wheelbase: number;
}

export interface TrackLayout {
  seed: number;
  /** Mean spacing in metres; gaps vary from 0.5 to 1.5 times it. */
  spacing: number;
  car: CarGeometry;
  points: readonly number[];
}

export interface JointHit {
  /** Seconds from now. */
  delay: number;
  gain: number;
  heavy: boolean;
}

const MIN_KMH = 5;
const SINGLE_AXLE_KMH = 15;
const NEIGHBOUR_GAIN = 10 ** (-8 / 20);
const POINTS_GAIN = 10 ** (4 / 20);

interface Axle {
  offset: number;
  gain: number;
  lead: boolean;
}

/** Front positive. */
function axles(car: CarGeometry): Axle[] {
  const half = car.wheelbase / 2;
  const bogies = [
    { centre: car.bogieCentres / 2, gain: 1 },
    { centre: -car.bogieCentres / 2, gain: 1 },
    { centre: car.length - car.bogieCentres / 2, gain: NEIGHBOUR_GAIN },
    { centre: -car.length + car.bogieCentres / 2, gain: NEIGHBOUR_GAIN },
  ];
  return bogies.flatMap(({ centre, gain }) => [
    { offset: centre + half, gain, lead: true },
    { offset: centre - half, gain, lead: false },
  ]);
}

function jointAt(layout: TrackLayout, index: number): number {
  const jitter = seeded((layout.seed ^ Math.imul(index, 0x9e3779b1)) >>> 0)() - 0.5;
  return (index + jitter * 0.5) * layout.spacing;
}

function hitsBetween(layout: TrackLayout, from: number, to: number, speedKmh: number) {
  const reach = layout.car.length + layout.car.wheelbase;
  const wheels = axles(layout.car).filter((axle) => speedKmh >= SINGLE_AXLE_KMH || axle.lead);
  const joints: { at: number; heavy: boolean }[] = [];
  const first = Math.floor((from - reach) / layout.spacing) - 1;
  const last = Math.ceil((to + reach) / layout.spacing) + 1;
  for (let index = first; index <= last; index++) {
    joints.push({ at: jointAt(layout, index), heavy: false });
  }
  for (const at of layout.points) joints.push({ at, heavy: true });
  const hits: { at: number; gain: number; heavy: boolean }[] = [];
  for (const joint of joints) {
    for (const axle of wheels) {
      const at = joint.at - axle.offset;
      if (at >= from && at < to)
        hits.push({ at, gain: axle.gain * (joint.heavy ? POINTS_GAIN : 1), heavy: joint.heavy });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

export function createJointScheduler(layout: TrackLayout) {
  let until = Number.NEGATIVE_INFINITY;
  return {
    reset(odometer: number) {
      until = odometer;
    },
    take(odometer: number, speedKmh: number, lookahead: number): JointHit[] {
      const metresPerSecond = speedKmh / 3.6;
      const from = Math.max(until, odometer);
      const to = odometer + metresPerSecond * lookahead;
      if (speedKmh < MIN_KMH || to <= from) {
        until = Math.max(until, odometer);
        return [];
      }
      until = to;
      const level = (speedKmh / 60) ** 1.3;
      return hitsBetween(layout, from, to, speedKmh).map((hit) => ({
        delay: (hit.at - odometer) / metresPerSecond,
        gain: hit.gain * level,
        heavy: hit.heavy,
      }));
    },
  };
}
