import { CanvasLayerCache } from '../../rendering/engine/canvas-cache';
import { hibiyaLanguageFrame, type HibiyaPairSchedule } from './schedule';
import { drawPanel, drawStaticPair } from './pages';
import { drawHeaderText } from './header';
import { drawPosition } from './route';
import {
  HIBIYA_PANEL_WIDTH,
  HIBIYA_PANEL_HEIGHT,
  HIBIYA_MULLION_WIDTH,
  HIBIYA_LCD_WIDTH,
  HIBIYA_LCD_HEIGHT,
} from './layout';
export function createHibiyaRenderer() {
  const cache = new CanvasLayerCache();
  let origin = 0,
    lastElapsed = -1,
    lastTime = 0;
  return {
    draw(
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      pair: HibiyaPairSchedule,
      time = pair.left.visibleElapsed,
      single?: 0 | 1,
    ): boolean {
      if (lastElapsed !== pair.left.visibleElapsed || time < lastTime) {
        origin = time;
        lastElapsed = pair.left.visibleElapsed;
      }
      lastTime = time;
      const elapsed = pair.left.visibleElapsed + Math.max(0, time - origin);
      const panels = single === undefined ? ([0, 1] as const) : ([single] as const);
      const models = [pair.left, pair.right] as const;
      const designWidth = single === undefined ? HIBIYA_LCD_WIDTH : HIBIYA_PANEL_WIDTH;
      const scale = Math.min(width / designWidth, height / HIBIYA_LCD_HEIGHT);
      const x = (width - designWidth * scale) / 2;
      const y = (height - HIBIYA_LCD_HEIGHT * scale) / 2;
      const key = panels.map((panel) => `${panel}:${models[panel].invalidationKey}`).join('|');
      const drawStatic = (target: CanvasRenderingContext2D) => {
        if (single === undefined) {
          drawStaticPair(target, pair);
        } else {
          drawPanel(target, models[single], single);
        }
      };
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      if (!cache.draw(ctx, key, designWidth, HIBIYA_LCD_HEIGHT, drawStatic)) {
        drawStatic(ctx);
      }
      for (const panel of panels) {
        const model = models[panel];
        const frame = hibiyaLanguageFrame(model.languages, elapsed, pair.languageOffset + panel);
        ctx.save();
        if (single === undefined) {
          ctx.translate(panel * (HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH), 0);
        }
        ctx.beginPath();
        ctx.rect(0, 0, panel === 0 ? 1040 : 1158, 224);
        ctx.clip();
        if (frame.animating) {
          ctx.save();
          ctx.translate(0, 112 * frame.progress);
          ctx.translate(0, 112);
          ctx.scale(1, 1 - frame.progress);
          ctx.translate(0, -112);
          ctx.globalAlpha = 1 - frame.progress;
          drawHeaderText(ctx, model, panel, frame.from);
          ctx.restore();
          ctx.save();
          ctx.translate(0, (-112 / 3) * (1 - frame.progress));
          ctx.translate(0, 112);
          ctx.scale(1, (2 + frame.progress) / 3);
          ctx.translate(0, -112);
          ctx.globalAlpha = frame.progress;
          drawHeaderText(ctx, model, panel, frame.to);
          ctx.restore();
        } else {
          drawHeaderText(ctx, model, panel, frame.to);
        }
        ctx.restore();
        if (
          model.page === 'broad' ||
          model.page === 'nearby' ||
          (panel === 0 && model.page === 'transfers')
        ) {
          drawPosition(ctx, model, panel, elapsed);
        }
      }
      if (single === undefined) {
        ctx.fillStyle = '#101416';
        ctx.fillRect(HIBIYA_PANEL_WIDTH, 0, HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT);
      }
      ctx.restore();
      // Keep the visible clock moving between flips; SceneScheduler suspends hidden/frozen scenes.
      const shown = models[single ?? 0];
      return shown.languages.length > 1 || ['broad', 'nearby'].includes(shown.page);
    },
    dispose() {
      cache.clear();
    },
  };
}
