import { describe, expect, it } from 'vitest';
import { pack } from './pack';

const GAP = 6;
// Inner avatar areas of 1x1, 2x1, 1x3 and 4x2 tiles at the deck's usual pitch.
const boxes = [
  [80, 80],
  [196, 80],
  [80, 312],
  [428, 196],
] as const;

describe('pack', () => {
  it('returns an empty layout for an empty channel', () => {
    expect(pack(0, 196, 196, GAP)).toEqual({ cols: 0, rows: 0, size: 0, overflow: 0 });
  });

  it.each(boxes.flatMap(([w, h]) => [1, 2, 7, 25, 99].map((n) => [n, w, h] as const)))(
    'keeps %i avatars inside %ix%i at the largest size without losing anyone',
    (n, w, h) => {
      const { cols, rows, size, overflow } = pack(n, w, h, GAP);
      expect(cols * size + (cols - 1) * GAP).toBeLessThanOrEqual(w);
      expect(rows * size + (rows - 1) * GAP).toBeLessThanOrEqual(h);
      if (overflow) {
        // Every cell but the last shows an avatar; the last one counts the rest.
        expect(cols * rows - 1 + overflow).toBe(n);
        expect(size).toBeGreaterThanOrEqual(22);
      } else {
        expect(cols * rows).toBeGreaterThanOrEqual(n);
        for (let c = 1; c <= n; c++) {
          const r = Math.ceil(n / c);
          const other = Math.floor(Math.min((w - (c - 1) * GAP) / c, (h - (r - 1) * GAP) / r));
          expect(other).toBeLessThanOrEqual(size);
        }
      }
    },
  );

  it('chips the overflow instead of shrinking avatars below legibility', () => {
    expect(pack(99, 80, 80, GAP)).toEqual({ cols: 3, rows: 3, size: 22, overflow: 91 });
  });
});
