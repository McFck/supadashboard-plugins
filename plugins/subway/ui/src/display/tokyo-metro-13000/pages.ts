import type { ScreenSchedule } from '../../rendering/screens';
import type { HibiyaPairSchedule } from './schedule';
import { drawHeader } from './header';
import { drawRoutePanel } from './route';
import { drawIcon } from '../../icons/paint';
import { routeTransfers, drawTransferDetail } from './transfers';
import { drawFittedText, phrase, fontFamily } from './text';
import {
  C,
  HEADER_BOTTOM,
  JAPANESE_FONT,
  LATIN_FONT,
  HIBIYA_PANEL_WIDTH,
  HIBIYA_PANEL_HEIGHT,
  HIBIYA_MULLION_WIDTH,
  HIBIYA_LCD_WIDTH,
  HIBIYA_LCD_HEIGHT,
} from './layout';
function drawPlatformGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(0, HEADER_BOTTOM, 1280, 720 - HEADER_BOTTOM);
  const details = model.guidanceStation.platformByDirection[model.snapshot.direction];
  const order = details?.carOrder ?? [7, 6, 5, 4, 3, 2, 1];
  const row = ctx.createLinearGradient(0, 318, 0, 420);
  row.addColorStop(0, '#e5e6e1');
  row.addColorStop(1, '#f7f8f4');
  ctx.fillStyle = row;
  ctx.fillRect(0, 318, 1280, 102);
  const x0 = 132,
    pitch = 144,
    trainY = 532;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#30332c';
  order.forEach((car, i) => {
    const x = x0 + i * pitch,
      current = car === model.currentCar;
    ctx.fillStyle = current ? C.current : '#f5f6f3';
    ctx.beginPath();
    ctx.roundRect(x, trainY, pitch - 2, 42, i === 0 || i === order.length - 1 ? 9 : 0);
    ctx.fill();
    ctx.stroke();
    drawFittedText(
      ctx,
      String(car),
      x + pitch / 2,
      trainY + 22,
      130,
      36,
      24,
      current ? C.white : C.ink,
      700,
      LATIN_FONT,
      'center',
    );
    if (current) {
      ctx.fillStyle = C.current;
      ctx.fillRect(x - 10, trainY - 96, pitch + 18, 65);
      drawFittedText(
        ctx,
        '現在地',
        x + pitch / 2,
        trainY - 75,
        pitch + 10,
        32,
        20,
        C.white,
        700,
        JAPANESE_FONT,
        'center',
      );
      drawFittedText(
        ctx,
        'You are here',
        x + pitch / 2,
        trainY - 45,
        pitch + 10,
        21,
        14,
        C.white,
        700,
        LATIN_FONT,
        'center',
      );
      ctx.beginPath();
      ctx.moveTo(x + 55, trainY - 29);
      ctx.lineTo(x + 88, trainY - 29);
      ctx.lineTo(x + 72, trainY - 5);
      ctx.fill();
    }
  });
  ctx.fillStyle = C.route;
  ctx.fillRect(x0, trainY + 44, pitch * order.length - 2, 9);
  // Only sourced facilities are placed; an empty station layout must not invent exits.
  for (const f of details?.facilities ?? []) {
    const position =
      f.relativePosition ?? Math.max(0, order.indexOf(f.car ?? 1) + 0.5) / order.length;
    const x = x0 + position * pitch * order.length;
    ctx.fillStyle = '#eabc45';
    ctx.fillRect(Math.max(12, Math.min(1000, x - 120)), 340, 268, 50);
    drawFittedText(
      ctx,
      f.label,
      Math.max(146, Math.min(1134, x + 14)),
      364,
      254,
      28,
      17,
      C.ink,
      600,
      JAPANESE_FONT,
      'center',
    );
    ctx.strokeStyle = '#30332c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (f.kind === 'stairs' || f.kind === 'escalator') {
      ctx.moveTo(x - 40, trainY);
      for (let j = 0; j < 5; j++) {
        ctx.lineTo(x - 40 + j * 14, trainY - (j + 1) * 13);
        ctx.lineTo(x - 26 + j * 14, trainY - (j + 1) * 13);
      }
      ctx.stroke();
    } else if (f.kind === 'lift') {
      ctx.strokeRect(x - 18, trainY - 74, 36, 74);
      drawFittedText(ctx, '↕', x, trainY - 40, 30, 38, 24, C.ink, 600, LATIN_FONT, 'center');
    }
  }
  routeTransfers(model.guidanceStation)
    .slice(0, 4)
    .forEach((sign, i) => {
      const x = 38 + (i % 2) * 600,
        y = 260 + Math.floor(i / 2) * 34;
      drawIcon(ctx, sign.icon, x, y, 27);
      drawFittedText(ctx, sign.ja + ' / ' + sign.en, x + 36, y + 15, 540, 24, 16, C.ink, 500);
    });
  drawFittedText(
    ctx,
    '足元にご注意ください。',
    800,
    642,
    540,
    26,
    18,
    '#a93a45',
    500,
    JAPANESE_FONT,
    'center',
  );
  drawFittedText(
    ctx,
    'この電車は ' + order.length + ' 両編成です。',
    24,
    694,
    1100,
    26,
    18,
    C.ink,
    500,
  );
}

function drawDoorGlyph(ctx: CanvasRenderingContext2D, doors: string): void {
  const gap = doors === 'open' ? 130 : doors === 'opening' || doors === 'closing' ? 60 : 0;
  ctx.fillStyle = '#e3e5e1';
  ctx.fillRect(406, 316, 468, 404);
  ctx.fillStyle = '#7f8787';
  ctx.fillRect(622 - gap / 2, 316, gap + 36, 404);
  for (const side of [0, 1]) {
    const left = 418 + side * 222 + (side === 0 ? -gap / 2 : gap / 2);
    const metal = ctx.createLinearGradient(left, 0, left + 212, 0);
    metal.addColorStop(0, '#8c9394');
    metal.addColorStop(0.12, '#626b70');
    metal.addColorStop(0.86, '#555d62');
    metal.addColorStop(1, '#aeb5b4');
    ctx.fillStyle = metal;
    ctx.fillRect(left, 316, 212, 404);
    ctx.strokeStyle = '#c4cbcb';
    ctx.lineWidth = 4;
    ctx.strokeRect(left + 7, 320, 198, 400);
    ctx.fillStyle = '#dde4e2';
    ctx.beginPath();
    ctx.roundRect(left + 35, 342, 142, 210, 20);
    ctx.fill();
    ctx.strokeStyle = '#32393c';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#eef2ef';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#d0d5d2';
    ctx.fillRect(left + (side === 0 ? 193 : 12), 560, 5, 76);
  }
}

function doorArrow(ctx: CanvasRenderingContext2D, x: number, direction: number): void {
  ctx.save();
  ctx.translate(x, 500);
  ctx.scale(direction, 1);
  const gradient = ctx.createLinearGradient(-96, 0, 96, 0);
  gradient.addColorStop(0, '#d27043');
  gradient.addColorStop(0.6, '#e18a52');
  gradient.addColorStop(1, '#f0d4b5');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(-96, 0);
  ctx.lineTo(0, -88);
  ctx.lineTo(0, -48);
  ctx.lineTo(112, -48);
  ctx.lineTo(112, 48);
  ctx.lineTo(0, 48);
  ctx.lineTo(0, 88);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDoorGuidance(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = '#eef0eb';
  ctx.fillRect(0, HEADER_BOTTOM, 1280, 720 - HEADER_BOTTOM);
  const closing = model.page === 'closing';
  const side =
    model.sideLabel === 'opposite side'
      ? '反対側'
      : model.sideLabel === 'both sides'
        ? '両側'
        : model.sideLabel
          ? 'こちら側'
          : '';
  const message = closing
    ? 'ドアが閉まります'
    : side
      ? side + 'のドアが開きます'
      : 'ドアにご注意ください';
  const english = closing
    ? 'Doors are closing.'
    : model.sideLabel === 'opposite side'
      ? 'Doors on the opposite side will open.'
      : model.sideLabel === 'both sides'
        ? 'Doors on both sides will open.'
        : model.sideLabel
          ? 'Doors on this side will open.'
          : 'Please take care around the doors.';
  drawFittedText(ctx, message + ' / ' + english, 12, 272, 1256, 38, 25, '#142432', 500);
  ctx.fillStyle = '#626a6b';
  ctx.fillRect(0, 302, 1280, 2);
  const opposite = model.sideLabel === 'opposite side';
  drawDoorGlyph(ctx, opposite ? 'closed' : model.snapshot.doors);
  if (closing || (model.sideLabel && !opposite)) {
    doorArrow(ctx, 230, closing ? -1 : 1);
    doorArrow(ctx, 1050, closing ? 1 : -1);
  }
  if (closing || model.snapshot.doors === 'open') {
    ctx.fillStyle = C.caution;
    ctx.fillRect(0, 680, 1280, 40);
    drawFittedText(
      ctx,
      closing ? 'ドアが閉まります ご注意ください' : 'ドアにご注意ください',
      20,
      700,
      950,
      28,
      22,
      C.ink,
      500,
    );
    drawFittedText(ctx, 'Caution', 1248, 700, 250, 28, 22, C.ink, 500, LATIN_FONT, 'right');
  }
}

function drawIncident(ctx: CanvasRenderingContext2D, model: ScreenSchedule, panel: 0 | 1): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 720 - HEADER_BOTTOM);
  ctx.fillStyle = C.caution;
  ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 10);
  if (panel === 0) {
    ctx.fillStyle = C.caution;
    ctx.beginPath();
    ctx.moveTo(104, 310);
    ctx.lineTo(202, 480);
    ctx.lineTo(6, 480);
    ctx.closePath();
    ctx.fill();
    drawFittedText(ctx, '!', 104, 420, 80, 90, 72, C.ink, 700, 'Arial, sans-serif', 'center');
    drawFittedText(
      ctx,
      phrase(model.language, model.snapshot.state),
      264,
      368,
      920,
      48,
      32,
      C.ink,
      700,
      fontFamily(model.language),
    );
  } else {
    (['ja', 'en', 'zh', 'ko'] as const).forEach((language, index) =>
      drawFittedText(
        ctx,
        phrase(language, model.snapshot.state),
        88,
        294 + index * 88,
        1080,
        42,
        27,
        C.ink,
        700,
        fontFamily(language),
      ),
    );
  }
}

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  panel: 0 | 1,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, HIBIYA_PANEL_WIDTH, HIBIYA_PANEL_HEIGHT);
  ctx.clip();
  ctx.fillStyle = C.body;
  ctx.fillRect(0, 0, HIBIYA_PANEL_WIDTH, HIBIYA_PANEL_HEIGHT);
  if (model.page === 'emergency' || model.page === 'suspension') {
    drawIncident(ctx, model, panel);
  } else if (model.page === 'platform' || model.page === 'closing') {
    if (panel === 0) {
      drawPlatformGuidance(ctx, model);
    } else {
      drawDoorGuidance(ctx, model);
    }
  } else if (model.page === 'broad' || model.page === 'nearby') {
    drawRoutePanel(ctx, model, panel);
  } else if (model.page === 'transfers') {
    if (panel === 0) {
      drawRoutePanel(ctx, model, panel);
    } else {
      drawTransferDetail(ctx, model);
    }
  }
  drawHeader(ctx, model, panel);
  ctx.restore();
}

export function drawStaticPair(ctx: CanvasRenderingContext2D, pair: HibiyaPairSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(0, 0, HIBIYA_LCD_WIDTH, HIBIYA_LCD_HEIGHT);
  drawPanel(ctx, pair.left, 0);
  ctx.save();
  ctx.translate(HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH, 0);
  drawPanel(ctx, pair.right, 1);
  ctx.restore();
  ctx.fillStyle = '#101416';
  ctx.fillRect(HIBIYA_PANEL_WIDTH, 0, HIBIYA_MULLION_WIDTH, HIBIYA_PANEL_HEIGHT);
}
