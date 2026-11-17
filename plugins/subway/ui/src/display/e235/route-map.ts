import type { ScreenSchedule } from '../../rendering/screens';
import type { LineFacts } from '../../data/contracts';
import { lineFactsFor } from '../../data/load';
import { e235Data, e235Minutes } from './data';
import {
  ACTIVE,
  E235_HEIGHT,
  HEADER,
  LINE,
  MARKER_RED,
  MEIRYO,
  SANS,
  YELLOW,
  displayName,
  e235Target,
  langOf,
  opposite,
  path,
  stopped,
  text,
} from './draw';

// Each cell is a 54px canvas with Margin="-0.2,0,-0.2,...", so cells advance by 53.6px; 15 of them are centred
// in the 944px ItemsControl (Margin 8,0,8,24), which puts the first cell's left edge at 77.2.
const CELL = 53.6;
const ROW_X = 8 + (944 - 15 * CELL) / 2;
const UPPER_TRACK = HEADER + 125; // Upper canvas: names 0..120, track at 125..161.
const LOWER_TOP = HEADER + 185 + 2 + 2; // Upper canvas 185 + margins.
const LOWER_TRACK = LOWER_TOP + 24;

/** Cell of a station in the line's two-row loop placement (`loopMap` in the line file). */
export function e235LoopCell(map: NonNullable<LineFacts['loopMap']>, code: string) {
  const top = map.upper.indexOf(code);
  return top >= 0 ? { index: top, upper: true } : { index: map.lower.indexOf(code), upper: false };
}
function loopPlacement(model: ScreenSchedule) {
  const map = lineFactsFor(model.line.id)?.loopMap;
  if (!map) throw new Error(`Line ${model.line.id} has no loopMap`);
  return map;
}
const cellX = (index: number) => ROW_X + index * CELL + CELL / 2;
const trackY = (upper: boolean) => (upper ? UPPER_TRACK : LOWER_TRACK) + 18;

/** Loop-end pieces copied from the theme; the 4px V-shaped gap between them is the white direction mark. */
function loopEnds(ctx: CanvasRenderingContext2D, forward: boolean) {
  const left = ROW_X + CELL - 27 - 90,
    right = ROW_X + 14 * CELL + 27;
  const [ul, ur, ll, lr] = forward ? [52, 68, -8, 8] : [68, 52, 8, -8]; // both pieces of an end notch the same way
  path(
    ctx,
    `M0,60 L0,56 A56,56 0 0 1 56,0 L90.5,0 L90.5,36 L56,36 A20,20 0 0 0 36,56 L36,60 L18,${ul} Z`,
    left,
    UPPER_TRACK,
    LINE,
  );
  path(
    ctx,
    `M-0.5,0 L34,0 A56,56 0 0 1 90,56 L90,60 L72,${ur} L54,60 L54,56 A20,20 0 0 0 34,36 L-0.5,36 Z`,
    right,
    UPPER_TRACK,
    LINE,
  );
  path(
    ctx,
    `M0,0 L0,4 A56,56 0 0 0 56,60 L90.5,60 L90.5,24 L56,24 A20,20 0 0 1 36,4 L36,0 L18,${ll} Z`,
    left,
    LOWER_TOP,
    LINE,
  );
  path(
    ctx,
    `M-0.5,60 L34,60 A56,56 0 0 0 90,4 L90,0 L72,${lr} L54,0 L54,4 A20,20 0 0 1 34,24 L-0.5,24 Z`,
    right,
    LOWER_TOP,
    LINE,
  );
}

/** Vertical Japanese label: Meiryo 25px, one column per line; the long-vowel mark turns vertical. */
function verticalLabel(
  ctx: CanvasRenderingContext2D,
  value: string,
  cx: number,
  top: number,
  bottom: number | null,
  color: string,
) {
  const columns =
    value.length > 5 && !value.includes('\n')
      ? [value.slice(0, 2), value.slice(2)]
      : value.split('\n');
  const step = 25;
  // The template puts a 20px spacer before the second column. After rotation the Viewbox is 39x120 above the
  // track and 39x115 below it.
  const contentH = Math.max(...columns.map((c, k) => k * 20 + [...c].length * step));
  const sx = Math.min(1, 39 / (columns.length * step)),
    sy = Math.min(1, (bottom === null ? 115 : 120) / contentH);
  const blockTop = bottom != null ? bottom - contentH * sy : top;
  columns.forEach((column, c) => {
    const x = cx + ((columns.length - 1) / 2 - c) * step * sx;
    const chars = [...column.replace(/ー/g, '丨')];
    chars.forEach((ch, i) => {
      ctx.save();
      ctx.translate(x, blockTop + (c * 20 + (i + 0.5) * step) * sy);
      ctx.scale(sx, sy);
      text(ctx, ch, 0, 0, step, MEIRYO, color, { align: 'center', baseline: 'middle' });
      ctx.restore();
    });
  });
}

export function drawE235RouteMap(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const lang = langOf(model),
    forward = !opposite(model);
  ctx.fillStyle = LINE;
  ctx.fillRect(ROW_X + CELL - 27, UPPER_TRACK, 14 * CELL, 36);
  ctx.fillRect(ROW_X + CELL - 27, LOWER_TRACK, 14 * CELL, 36);
  loopEnds(ctx, forward);
  const target = e235Target(model).code,
    placement = loopPlacement(model);
  const minutes = new Map(
    [...e235Minutes(model.snapshot, model.route)].filter(
      ([, m]) => m > 0 && m <= e235Data.routeMap.maxArrivalTimeToDisplay!,
    ),
  );
  for (const station of model.line.stations) {
    const cell = e235LoopCell(placement, station.code),
      cx = cellX(cell.index),
      cy = trackY(cell.upper);
    const isCurrent = station.code === target,
      min = minutes.get(station.code);
    if (!(isCurrent && stopped(model))) {
      const big = min != null;
      ctx.fillStyle = isCurrent ? YELLOW : '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, big || isCurrent ? 16 : 8, 0, Math.PI * 2);
      ctx.fill();
      if (isCurrent) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (big)
        text(ctx, String(min), cx, cy + 1, 24, SANS, ACTIVE, {
          weight: 700,
          align: 'center',
          baseline: 'middle',
          maxWidth: 24,
        });
    }
    const name = displayName(station, lang === 'en' ? 'en' : 'ja', 'RouteMap');
    if (lang === 'en') {
      ctx.save();
      ctx.translate(cx, cell.upper ? cy - 26 : cy + 26);
      ctx.rotate(-Math.PI / 3);
      const lines = name.split('\n');
      lines.forEach((line, k) =>
        text(
          ctx,
          line,
          0,
          6 + (k - (lines.length - 1) / 2) * 19 - (lines.length > 1 ? 2.5 : 0),
          20,
          SANS,
          ACTIVE,
          { align: cell.upper ? 'left' : 'right', maxWidth: 115 },
        ),
      );
      ctx.restore();
    } else
      verticalLabel(
        ctx,
        name,
        cx,
        cell.upper ? 0 : LOWER_TRACK + 41,
        cell.upper ? UPPER_TRACK - 5 : null,
        ACTIVE,
      );
  }
  const caption =
    lang === 'en'
      ? 'Transfer and waiting times are not included. Times may differ by train.'
      : 'のりかえ、待合わせ時間は含まれません。電車により多少時間が異なります。';
  text(
    ctx,
    caption,
    16,
    E235_HEIGHT - 6,
    lang === 'en' ? 13 : 12,
    lang === 'en' ? SANS : MEIRYO,
    ACTIVE,
  );
}

/** RouteMap cursor (RunningMarker: 1.2s loop, slides -48 to -28px, fades) or StoppingMarker (1s pulse). */
export function routeMapMarker(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  const target = e235Target(model),
    cell = e235LoopCell(loopPlacement(model), target.code),
    cx = cellX(cell.index),
    cy = trackY(cell.upper);
  const forward = !opposite(model);
  // Which way the train runs along this row on screen.
  const dir = cell.upper ? (forward ? 1 : -1) * -1 : forward ? 1 : -1;
  const towards = opposite(model) ? (cell.upper ? -1 : 1) : cell.upper ? 1 : -1;
  void dir;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(towards, 1);
  if (stopped(model)) {
    const t = (time % 1000) / 1000,
      h = t < 0.5 ? 34 + 16 * t : 42 - 16 * (t - 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-28, -21);
    ctx.lineTo(22, -21);
    ctx.lineTo(28, 0);
    ctx.lineTo(22, 21);
    ctx.lineTo(-28, 21);
    ctx.closePath();
    ctx.fill();
    const s = h / 40;
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = MARKER_RED;
    ctx.beginPath();
    ctx.moveTo(-24, -20);
    ctx.lineTo(18, -20);
    ctx.lineTo(24, 0);
    ctx.lineTo(18, 20);
    ctx.lineTo(-24, 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const t = ((time % 1200) / 1200) * 1.2,
      x = t < 0.6 ? -48 + (20 * t) / 0.6 : -28;
    ctx.globalAlpha = Math.min(1, t / 0.2, t < 0.9 ? 1 : 1 - (t - 0.9) / 0.3);
    ctx.translate(x - 12, -20);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    [
      [0, 0],
      [16, 0],
      [24, 20],
      [16, 40],
      [0, 40],
      [8, 20],
    ].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = MARKER_RED;
    ctx.beginPath();
    [
      [2, 0],
      [14, 0],
      [22, 20],
      [14, 40],
      [2, 40],
      [10, 20],
    ].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
