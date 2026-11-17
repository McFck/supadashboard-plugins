import type { ScreenSchedule } from '../../rendering/screens';
import { CanvasLayerCache } from '../../rendering/engine/canvas-cache';
import { paintFitted } from '../../rendering/engine/canvas-renderer';
import { drawSignBadge } from '../../icons/badge';
import { drawFittedText, JAPANESE_FONT } from '../../rendering/lcd/shared';
import { nameOf, displayDestination, stateLabel } from './model';
import {
  SAKAISUJI_COLORS as C,
  SAKAISUJI_LCD_WIDTH,
  SAKAISUJI_LCD_HEIGHT,
  fillRounded,
} from './layout';
import { drawPage } from './pages';

function drawHeader(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const next = ['stopped', 'arriving'].includes(model.snapshot.state)
    ? model.station
    : (model.nextStation ?? model.station);
  const gradient = ctx.createLinearGradient(0, 0, 0, 108);
  gradient.addColorStop(0, '#8e4a22');
  gradient.addColorStop(0.72, '#a9632e');
  gradient.addColorStop(1, '#ca9855');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1920, 108);
  fillRounded(ctx, 24, 17, 300, 72, '#263341');
  ctx.strokeStyle = '#edf1ef';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(24, 17, 300, 72, 18);
  ctx.stroke();
  drawFittedText(
    ctx,
    model.language === 'kana' ? 'ふつう' : '普　通',
    174,
    54,
    274,
    46,
    32,
    C.white,
    700,
    JAPANESE_FONT,
    'center',
  );
  drawFittedText(
    ctx,
    displayDestination(model).replace('方面', ' ゆき').replace('ほうめん', ' ゆき'),
    350,
    56,
    730,
    46,
    32,
    C.white,
    700,
    JAPANESE_FONT,
  );
  drawFittedText(ctx, stateLabel(model), 1110, 59, 260, 36, 26, C.white, 700, JAPANESE_FONT);
  fillRounded(ctx, 1334, 16, 486, 76, '#f8faf6');
  drawFittedText(
    ctx,
    nameOf(next, model.language),
    1536,
    54,
    366,
    51,
    32,
    '#263341',
    700,
    JAPANESE_FONT,
    'center',
  );
  drawSignBadge(ctx, next.code, 1745, 24, 60, C.header);
  drawFittedText(ctx, 'です', 1830, 62, 80, 28, 22, C.white);
}

function drawStatic(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(0, 0, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT);
  drawHeader(ctx, model);
  drawPage(ctx, model);
}

export function createHankyu1300Renderer() {
  const cache = new CanvasLayerCache();
  return {
    draw(
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      model: ScreenSchedule,
    ): void {
      paintFitted(ctx, width, height, SAKAISUJI_LCD_WIDTH, SAKAISUJI_LCD_HEIGHT, () => {
        const painted = cache.draw(
          ctx,
          model.invalidationKey,
          SAKAISUJI_LCD_WIDTH,
          SAKAISUJI_LCD_HEIGHT,
          (layer) => drawStatic(layer, model),
        );
        if (!painted) {
          drawStatic(ctx, model);
        }
      });
    },
    dispose() {
      cache.clear();
    },
  };
}
