export function paintFitted(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  designWidth: number,
  designHeight: number,
  paint: () => boolean | void,
): boolean {
  const scale = Math.min(width / designWidth, height / designHeight);
  ctx.save();
  ctx.translate((width - designWidth * scale) / 2, (height - designHeight * scale) / 2);
  ctx.scale(scale, scale);
  const animating = paint() === true;
  ctx.restore();
  return animating;
}
