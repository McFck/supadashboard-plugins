import type { PaintedIcon } from './contracts';
import { drawRingBadge } from './badge';
import { drawFittedCentered } from './text';

const SANS = '"Microsoft Sans Serif", "MS UI Gothic", Arial, sans-serif';
const LATIN = 'Arial, Helvetica, sans-serif';

/** Black letter squeezed horizontally to `width` (64-unit symbol space), as the source theme draws it. */
function letter(
  ctx: CanvasRenderingContext2D,
  value: string,
  baseline: number,
  size: number,
  width: number,
  weight: number,
): void {
  ctx.font = `${weight} ${size}px ${SANS}`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  const measured = ctx.measureText(value).width;
  ctx.save();
  ctx.translate(32, baseline);
  if (measured > width) ctx.scale(width / measured, 1);
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function fill(ctx: CanvasRenderingContext2D, points: number[][], color: string): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRing(ctx: CanvasRenderingContext2D, icon: PaintedIcon): void {
  ctx.beginPath();
  ctx.arc(32, 32, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 19, 0, Math.PI * 2);
  ctx.fill();
  letter(ctx, icon.letter ?? '', 43, 30, 38, 700);
}

function drawTrain(ctx: CanvasRenderingContext2D, icon: PaintedIcon): void {
  ctx.beginPath();
  ctx.roundRect(0, 0, 64, 64, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(14, 6, 36, 40, 6);
  ctx.fill();
  ctx.fillStyle = icon.color;
  ctx.fillRect(25, 8.5, 14, 3);
  ctx.fillRect(18, 15, 28, 14);
  for (const cx of [21, 43]) {
    ctx.beginPath();
    ctx.arc(cx, 38, 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  fill(
    ctx,
    [
      [22, 45],
      [42, 45],
      [52, 58],
      [48, 58],
      [41, 49],
      [23, 49],
      [16, 58],
      [12, 58],
    ],
    '#ffffff',
  );
}

function drawLetterBox(ctx: CanvasRenderingContext2D, icon: PaintedIcon): void {
  ctx.beginPath();
  ctx.roundRect(0, 0, 64, 64, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(6, 6, 52, 52);
  letter(ctx, icon.letter ?? '', 44, 34, 52, 400);
}

/** Outlined square sign; the border is 2px at every size, so it is drawn in pixel space. */
function drawSquare(
  ctx: CanvasRenderingContext2D,
  icon: PaintedIcon,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillStyle = icon.color;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
  drawFittedCentered(
    ctx,
    icon.letter || '↔',
    x + size / 2,
    y + size / 2,
    size - 3,
    size * 0.64,
    8,
    icon.color,
    LATIN,
  );
}

function drawSolid(ctx: CanvasRenderingContext2D, icon: PaintedIcon): void {
  ctx.fillRect(0, 0, 64, 64);
  if (icon.secondaryColor) {
    ctx.fillStyle = icon.secondaryColor;
    ctx.fillRect(0, 32, 64, 32);
  }
}

/** Draws a line symbol into the `size` square at (x, y). */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: PaintedIcon,
  x: number,
  y: number,
  size: number,
): void {
  if (icon.shape === 'round') {
    drawRingBadge(ctx, icon.letter ?? '', x, y, size, icon.color);
    return;
  }
  if (icon.shape === 'square') {
    drawSquare(ctx, icon, x, y, size);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  ctx.fillStyle = icon.color;
  if (icon.shape === 'ring') drawRing(ctx, icon);
  else if (icon.shape === 'train') drawTrain(ctx, icon);
  else if (icon.shape === 'solid') drawSolid(ctx, icon);
  else drawLetterBox(ctx, icon);
  ctx.restore();
}
