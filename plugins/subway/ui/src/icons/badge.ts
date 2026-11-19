import { drawFittedCentered } from './text';

const RING_FONT = 'Arial, Helvetica, sans-serif';
const SIGN_FONT = 'Arial, sans-serif';

export function drawRingBadge(
  ctx: CanvasRenderingContext2D,
  code: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const ink = '#080908';
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * 0.39, 0, Math.PI * 2);
  ctx.fill();
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  drawFittedCentered(
    ctx,
    parts?.[1] ?? code,
    x + size / 2,
    y + size * (parts ? 0.33 : 0.51),
    size * 0.7,
    size * 0.37,
    8,
    ink,
    RING_FONT,
  );
  if (parts) {
    drawFittedCentered(
      ctx,
      parts[2]!,
      x + size / 2,
      y + size * 0.67,
      size * 0.7,
      size * 0.41,
      8,
      ink,
      RING_FONT,
    );
  }
}

export function drawSignBadge(
  ctx: CanvasRenderingContext2D,
  code: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const circular = /^[A-Z]{1,2}\d{1,2}$/.test(code) && !code.startsWith('JY');
  ctx.fillStyle = color;
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#ffffff';
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.37, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x + size * 0.13, y + size * 0.13, size * 0.74, size * 0.74);
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  ctx.fillStyle = '#202629';
  ctx.font = `700 ${Math.max(8, size * (parts ? 0.27 : 0.34))}px ${SIGN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(parts?.[1] ?? code, x + size / 2, y + size * (parts ? 0.34 : 0.5), size * 0.7);
  if (parts) {
    ctx.font = `700 ${Math.max(8, size * 0.36)}px ${SIGN_FONT}`;
    ctx.fillText(parts[2]!, x + size / 2, y + size * 0.64, size * 0.68);
  }
}
