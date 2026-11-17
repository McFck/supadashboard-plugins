/** Centred single-line text that shrinks (never below `min`) to fit `width`. */
export function drawFittedCentered(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  min: number,
  color: string,
  font: string,
): void {
  ctx.font = `700 ${size}px ${font}`;
  const fitted = Math.max(
    min,
    Math.min(size, (size * width) / Math.max(1, ctx.measureText(value).width)),
  );
  ctx.font = `700 ${fitted}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y, width);
}
