import { describe, expect, it } from 'vitest';
import type { ScreenSchedule } from '../../rendering/screens';
import { e235Data, e235TransferLayout } from './data';
import { drawE235DetailedTransfers } from './transfers';
import { drawE235Page } from './pages';

function recordingContext() {
  const text: string[] = [];
  const fillStyles: string[] = [];
  const rectangles: { color: string; bounds: number[] }[] = [];
  let fillStyle = '#000000';
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'measureText') return () => ({ width: 100 });
        if (key === 'fillText') return (value: string) => text.push(value);
        if (key === 'fillRect')
          return (...bounds: number[]) => rectangles.push({ color: fillStyle, bounds });
        return () => {};
      },
      set(_target, key, value) {
        if (key === 'fillStyle') {
          fillStyle = String(value);
          fillStyles.push(fillStyle);
        }
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, text, fillStyles, rectangles };
}

function screen(page: ScreenSchedule['page'], language: ScreenSchedule['language'] = 'ja') {
  return {
    page,
    language,
    visibleElapsed: 0,
    iconPhase: 0,
    snapshot: { state: 'stopped', station: 'JY13', direction: 'inner' },
    station: { code: 'JY13' },
  } as unknown as ScreenSchedule;
}

describe('E235 source transfer layouts', () => {
  it('places every layout cell on one transfer of its station, inside the grid and without overlap', () => {
    for (const station of e235Data.stations) {
      for (const display of station.transferDisplays) {
        for (const layout of display.layouts) {
          const where = `${station.code} ${layout.mode}`;
          const cells = new Set<string>();
          for (const item of layout.lines) {
            expect(station.transfers[item.ref], where).toBeDefined();
            expect(item.row, where).toBeLessThan(layout.rows);
            expect(item.column + (item.columnSpan ?? 1), where).toBeLessThanOrEqual(layout.columns);
            cells.add(`${item.row}:${item.column}`);
          }
          expect(cells.size, where).toBe(layout.lines.length);
        }
      }
    }
  });

  it('renders Ikebukuro transfers in the source row order with their source icon types', () => {
    const layout = e235TransferLayout('JY13', 'inner', 'Transfers', 'ja');
    const { ctx, text, fillStyles } = recordingContext();
    drawE235Page(ctx, screen('transfers'));

    const expected = layout.lines.map((item) => item.transfer.ja.replace(/\n/g, ''));
    expect(text.filter((value) => expected.includes(value))).toEqual(expected);
    expect(layout.lines.map((item) => [item.ref, item.row, item.column])).toEqual([
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, 2],
      [3, 1, 0],
      [4, 1, 1],
      [5, 1, 2],
      [6, 2, 0],
    ]);
    expect(layout.lines.map((item) => item.transfer.icons[0]?.shape)).toEqual([
      'letter-box',
      'letter-box',
      'train',
      'train',
      'ring',
      'ring',
      'ring',
    ]);
    expect(layout.lines[0]?.iconRef).toBe(1);
    expect(fillStyles).toContain('#ff2a00');
    expect(fillStyles).not.toContain('#ff8c00');
  });

  it('uses the DetailedRouteMap row and column assignments and preserves source line breaks', () => {
    const layout = e235TransferLayout('JY13', 'inner', 'DetailedRouteMap', 'ja');
    const { ctx, text } = recordingContext();
    drawE235DetailedTransfers(ctx, screen('nearby'), false);

    const expected = layout.lines.flatMap((item) => (item.aliasJa || item.transfer.ja).split('\n'));
    expect(text.filter((value) => expected.includes(value))).toEqual(expected);
    expect(layout.lines.map((item) => [item.ref, item.row, item.column])).toEqual([
      [0, 0, 0],
      [1, 0, 1],
      [2, 1, 0],
      [3, 1, 1],
      [4, 2, 0],
      [5, 2, 1],
      [6, 3, 0],
    ]);
  });
});
