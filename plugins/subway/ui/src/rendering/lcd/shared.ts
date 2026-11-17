export const JAPANESE_FONT = '"Yu Gothic UI", Meiryo, "Noto Sans JP", sans-serif';

function fittedFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight = 700,
  family = JAPANESE_FONT,
): string {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return `${weight} ${Math.max(minSize, size)}px ${family}`;
}

export function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  color: string,
  weight = 700,
  family = JAPANESE_FONT,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = fittedFont(ctx, text, maxWidth, maxSize, minSize, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, maxWidth);
}
