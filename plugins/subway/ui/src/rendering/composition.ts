import { SAKAISUJI_LCD_HEIGHT, SAKAISUJI_LCD_WIDTH } from '../display/hankyu-1300/layout';

// Design units: 1920 wide, as tall as the page aspect.
const DESIGN_WIDTH = 1920;
const MIN_STRIP = 144;
const MAX_STRIP = 200;

export function displayAspect(lineId: unknown) {
  return lineId === 'sakaisuji' ? SAKAISUJI_LCD_WIDTH / SAKAISUJI_LCD_HEIGHT : 16 / 9;
}

export function subwayComposition(
  viewport: { width: number; height: number } | undefined,
  aspect: number,
) {
  const native = DESIGN_WIDTH / aspect;
  const height =
    viewport && viewport.width > 0 && viewport.height > 0
      ? (DESIGN_WIDTH * viewport.height) / viewport.width
      : native + MIN_STRIP;
  const strip = Math.min(height / 2, Math.max(MIN_STRIP, Math.min(MAX_STRIP, height - native)));
  return {
    height,
    display: { w: DESIGN_WIDTH, h: height - strip },
    strip,
  };
}
