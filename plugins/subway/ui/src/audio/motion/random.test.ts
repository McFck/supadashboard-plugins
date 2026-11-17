import { describe, expect, it } from 'vitest';
import { createPicker, seeded } from './random';

describe('one-shot sample pools', () => {
  it('never repeats any of the last two picks, and uses the whole pool', () => {
    const pick = createPicker(4, seeded(11));
    const picks = Array.from({ length: 400 }, pick);
    picks.slice(2).forEach((value, index) => {
      expect(value).not.toBe(picks[index]);
      expect(value).not.toBe(picks[index + 1]);
    });
    expect(new Set(picks).size).toBe(4);
  });

  it('still alternates in a pool of two and keeps a pool of one playable', () => {
    const pair = createPicker(2, seeded(3));
    const picks = Array.from({ length: 20 }, pair);
    picks.slice(1).forEach((value, index) => expect(value).not.toBe(picks[index]));
    const single = createPicker(1, seeded(3));
    expect([single(), single()]).toEqual([0, 0]);
  });
});
