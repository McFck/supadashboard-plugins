import type { AppletSceneFactory, AppletSceneRenderer } from '@supadashboard/kit';
import { createHibiyaRenderer } from '../display/tokyo-metro-13000/renderer';
import { scheduleHibiyaPair } from '../display/tokyo-metro-13000/schedule';
import { createHankyu1300Renderer } from '../display/hankyu-1300/renderer';
import { createYamanoteRenderer } from '../display/e235/renderer';
import { e235Images } from '../display/e235/images';
import { e235WallClock } from '../display/e235/schedule';
import { carNumber, displayLanguages } from '../simulation/config';
import { lineFactsFor } from '../data/load';
import { scheduleScreen, type ScreenConfig } from './screens';
import type { SubwaySceneState } from '../simulation/scene-state';
import type { PreparedFrame, SubwayScreen } from './contracts';
import { displayAspect } from './composition';

export type SubwaySceneData = SubwaySceneState & { visibleElapsed: number; wallMs?: number };

const BACKGROUND = '#10171b';

function extendEdges(ctx: CanvasRenderingContext2D, width: number, height: number, aspect: number) {
  const w = Math.min(width, height * aspect),
    h = w / aspect;
  const x = (width - w) / 2,
    y = (height - h) / 2;
  if (x < 0.5 && y < 0.5) {
    return;
  }
  // Whole backing pixels: a stretch starting mid-pixel blends over the antialiased LCD edge into a seam.
  // Sources sit one pixel inside the fully covered LCD, and smoothing is off so the copy is exact.
  const { a: sx, d: sy } = ctx.getTransform();
  const canvas = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (x >= 0.5) {
    const left = Math.ceil(x * sx),
      right = Math.floor((x + w) * sx);
    ctx.drawImage(canvas, left + 1, 0, 1, canvas.height, 0, 0, left, canvas.height);
    ctx.drawImage(
      canvas,
      right - 2,
      0,
      1,
      canvas.height,
      right,
      0,
      canvas.width - right,
      canvas.height,
    );
  } else {
    const top = Math.ceil(y * sy),
      bottom = Math.floor((y + h) * sy);
    ctx.drawImage(canvas, 1, top + 1, 1, 1, 0, 0, canvas.width, top);
    ctx.drawImage(canvas, 1, bottom - 2, 1, 1, 0, bottom, canvas.width, canvas.height - bottom);
  }
  ctx.restore();
}

export function sceneLanguages(source: SubwaySceneState): readonly string[] {
  return displayLanguages(
    source.config.displayLanguages ?? lineFactsFor(source.line.id)?.displayLanguages[0],
  );
}

export function prepareFrame(
  data: SubwaySceneData,
  view: string,
  screen: SubwayScreen,
): PreparedFrame {
  const { line, snapshot, visibleElapsed } = data;
  const fill = data.config.fillScreen !== false;
  const wall =
    line.id === 'yamanote' && data.wallMs !== undefined ? e235WallClock(data.wallMs) : undefined;
  const config: ScreenConfig = {
    line,
    languages: sceneLanguages(data),
    currentCar: carNumber(data.config.carNumber, line.carCount) ?? 1,
    clock: wall?.label,
    manualView: view === 'map' || view === 'cab' ? 'map' : 'display',
  };
  const minuteMs = wall?.wakeInMs ?? Infinity;
  const wake = (nextDeadline: number | null) => {
    const delay = Math.min(
      nextDeadline === null ? Infinity : nextDeadline - visibleElapsed,
      minuteMs,
    );
    return Number.isFinite(delay) ? Math.max(0, delay) : null;
  };
  if (line.id === 'hibiya') {
    const pair = scheduleHibiyaPair(snapshot, config, visibleElapsed);
    const panel = screen === 'right' ? 1 : 0;
    const shown = panel === 1 ? pair.right : pair.left;
    return {
      kind: 'pair',
      line,
      pair,
      panel,
      fill,
      revision: `${panel}|${shown.invalidationKey}|${fill}`,
      wakeInMs: wake(shown.nextDeadline),
    };
  }
  const schedule = scheduleScreen(snapshot, config, visibleElapsed);
  return {
    kind: 'screen',
    line,
    schedule,
    fill,
    revision: `${
      line.id === 'yamanote'
        ? `${schedule.invalidationKey}|${e235Images.revision}`
        : schedule.invalidationKey
    }|${fill}`,
    wakeInMs: wake(schedule.nextDeadline),
  };
}

export const createSubwayScene: AppletSceneFactory<
  PreparedFrame | undefined
> = (): AppletSceneRenderer<PreparedFrame | undefined> => {
  const opened: { dispose(): void }[] = [];
  const once = <T extends { dispose(): void }>(create: () => T) => {
    let renderer: T | undefined;
    return () => {
      if (!renderer) {
        renderer = create();
        opened.push(renderer);
      }
      return renderer;
    };
  };
  const yamanote = once(createYamanoteRenderer);
  const hibiya = once(createHibiyaRenderer);
  const sakaisuji = once(createHankyu1300Renderer);
  return {
    draw({ ctx, width, height, data, time }) {
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, height);
      if (!data) {
        return false;
      }
      let animating = false;
      if (data.kind === 'pair') {
        animating = hibiya().draw(ctx, width, height, data.pair, time, data.panel);
      } else if (data.line.id === 'yamanote') {
        animating = yamanote().draw(ctx, width, height, data.schedule, time);
      } else {
        sakaisuji().draw(ctx, width, height, data.schedule);
      }
      if (data.fill) {
        extendEdges(ctx, width, height, displayAspect(data.line.id));
      }
      return animating;
    },
    dispose() {
      for (const renderer of opened) {
        renderer.dispose();
      }
    },
  };
};
