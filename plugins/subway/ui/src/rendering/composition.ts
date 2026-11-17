import { SAKAISUJI_LCD_HEIGHT, SAKAISUJI_LCD_WIDTH } from '../display/hankyu-1300/layout';

// The design is 1920 px wide and as tall as the page's aspect, so it fills the page at one scale. The display
// spans the full width at its LCD's ratio and the control strip below takes the remaining height within its
// bounds; past them the display's canvas is wider or taller than the LCD and the scene extends the LCD's edges.
const DESIGN_WIDTH = 1920;
const MIN_STRIP = 144;
const MAX_STRIP = 200;

/** Width over height of the line's LCD; Yamanote and one Hibiya panel are 1280 × 720. */
export function displayAspect(lineId: unknown) {
  return lineId === 'sakaisuji' ? SAKAISUJI_LCD_WIDTH / SAKAISUJI_LCD_HEIGHT : 16 / 9;
}

/** Without a viewport (the editor preview) the display shows at its own ratio above the smallest strip. */
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
