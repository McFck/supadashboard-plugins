export const SANS = '"Microsoft Sans Serif", "MS UI Gothic", Arial, sans-serif';
export const JA = 'Meiryo, "Yu Gothic UI", sans-serif';
export const UI = '"Meiryo UI", Meiryo, sans-serif';
export function label(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  width = 0,
  color = '#000000',
  family = SANS,
  weight = 400,
  align: CanvasTextAlign = 'left',
) {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  const measured = ctx.measureText(value).width;
  ctx.save();
  ctx.translate(x, y);
  if (width && measured > width) ctx.scale(width / measured, 1);
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

export function polygon(ctx: CanvasRenderingContext2D, points: number[][], color: string) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function carBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  head: boolean,
  tail: boolean,
  inset = false,
) {
  const rx = inset ? 9 : 12,
    ry = inset ? 11 : 14;
  ctx.beginPath();
  ctx.moveTo(x + (head ? rx : 0), y);
  ctx.lineTo(x + width - (tail ? rx : 0), y);
  if (tail) {
    ctx.ellipse(x + width - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
    ctx.lineTo(x + width, y + height - ry);
    ctx.ellipse(x + width - rx, y + height - ry, rx, ry, 0, 0, Math.PI / 2);
  } else ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + (head ? rx : 0), y + height);
  if (head) {
    ctx.ellipse(x + rx, y + height - ry, rx, ry, 0, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + ry);
    ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  } else ctx.lineTo(x, y);
  ctx.closePath();
}
