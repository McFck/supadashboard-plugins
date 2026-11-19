import { describe, expect, it } from 'vitest';
import { createJointScheduler, type TrackLayout } from './joints';

const car = { length: 20, bogieCentres: 13.8, wheelbase: 2.1 };
const layout = (points: number[] = []): TrackLayout => ({ seed: 7, spacing: 90, car, points });

function drive(
  scheduler: ReturnType<typeof createJointScheduler>,
  speedKmh: number,
  seconds: number,
  tick = 0.05,
) {
  const hits: number[] = [];
  let odometer = 0;
  for (let time = 0; time < seconds; time += tick) {
    for (const hit of scheduler.take(odometer, speedKmh, 0.25)) hits.push(time + hit.delay);
    odometer += (speedKmh / 3.6) * tick;
  }
  return hits;
}

describe('rail joint scheduling', () => {
  it('plays the axle-pair and bogie rhythm of the car at speed, each hit once', () => {
    const scheduler = createJointScheduler(layout());
    scheduler.reset(0);
    const hits = drive(scheduler, 60, 30);
    const gaps = hits.slice(1).map((time, index) => time - hits[index]);
    // 2.1 m wheelbase at 16.7 m/s: 126 ms between the two axles of a bogie.
    expect(gaps.some((gap) => Math.abs(gap - 0.126) < 0.002)).toBe(true);
    expect(gaps.every((gap) => gap > 0.001)).toBe(true);
    // Eight axles per joint (this car and both neighbours' near bogies); about 5.5 joints in 30 s at 90 m.
    expect(hits.length / 8).toBeGreaterThan(3);
    expect(hits.length / 8).toBeLessThan(10);
  });

  it('keeps every hit of a joint that straddles a tick boundary', () => {
    const metresPerSecond = 40 / 3.6;
    const whole = createJointScheduler(layout());
    whole.reset(0);
    const once = whole.take(0, 40, 30).map((hit) => hit.delay * metresPerSecond);
    const split = createJointScheduler(layout());
    split.reset(0);
    const pieces: number[] = [];
    for (let tick = 0; tick < 30 / 0.037; tick++) {
      const odometer = tick * 0.037 * metresPerSecond;
      for (const hit of split.take(odometer, 40, 0.037))
        pieces.push(odometer + hit.delay * metresPerSecond);
    }
    expect(pieces.length).toBe(once.length);
    pieces.forEach((at, index) => expect(at).toBeCloseTo(once[index], 6));
  });

  it('is silent at a standstill and drops skipped track after a catch-up jump', () => {
    const scheduler = createJointScheduler(layout([50, 58]));
    scheduler.reset(0);
    expect(scheduler.take(0, 0, 0.25)).toEqual([]);
    expect(scheduler.take(0, 3, 0.25)).toEqual([]);
    const after = scheduler.take(5_000, 60, 0.25);
    expect(after.every((hit) => hit.delay >= 0)).toBe(true);
    expect(scheduler.take(4_000, 60, 0.25)).toEqual([]);
  });

  it('plays points as heavier hits on top of the regular joints', () => {
    const scheduler = createJointScheduler(layout([500]));
    scheduler.reset(480);
    const hits = scheduler.take(480, 30, 4);
    const heavy = hits.filter((hit) => hit.heavy);
    expect(heavy.length).toBeGreaterThan(0);
    expect(Math.max(...heavy.map((hit) => hit.gain))).toBeGreaterThan(
      Math.max(...hits.filter((hit) => !hit.heavy).map((hit) => hit.gain)),
    );
  });
});
