export type Pack = { cols: number; rows: number; size: number; overflow: number };

/** Smallest legible avatar in px; below it the last cell becomes a "+N" chip. */
const MIN = 22;

const cellSize = (cols: number, rows: number, w: number, h: number, gap: number) =>
  Math.floor(Math.min((w - (cols - 1) * gap) / cols, (h - (rows - 1) * gap) / rows));

/** Square avatar grid for `n` members in a `w`×`h` px box: the largest cell, then the aspect closest to the box. */
export function pack(n: number, w: number, h: number, gap: number): Pack {
  if (n <= 0) {
    return { cols: 0, rows: 0, size: 0, overflow: 0 };
  }
  const skew = (cols: number, rows: number) => Math.abs(Math.log(cols / rows / (w / h)));
  let best: Pack = { cols: 0, rows: 0, size: -Infinity, overflow: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const size = cellSize(cols, rows, w, h, gap);
    if (size > best.size || (size === best.size && skew(cols, rows) < skew(best.cols, best.rows))) {
      best = { cols, rows, size, overflow: 0 };
    }
  }
  if (best.size >= MIN) {
    return best;
  }
  const cols = Math.max(1, Math.floor((w + gap) / (MIN + gap)));
  const rows = Math.max(1, Math.floor((h + gap) / (MIN + gap)));
  const cells = cols * rows;
  return {
    cols,
    rows,
    size: Math.max(0, cellSize(cols, rows, w, h, gap)),
    overflow: cells >= n ? 0 : n - cells + 1,
  };
}
