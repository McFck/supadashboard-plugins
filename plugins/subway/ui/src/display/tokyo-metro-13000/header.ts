import type { ScreenSchedule } from '../../rendering/screens';
import type { ScreenLanguage } from '../../rendering/screens';
import { targetStation, destinationName } from './model';
import { drawRingBadge } from '../../icons/badge';
import { drawFittedText, phrase, fontFamily, stationName } from './text';
import { C, JAPANESE_FONT, LATIN_FONT } from './layout';
export function drawHeader(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  panel: 0 | 1,
): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, 224);
  gradient.addColorStop(0, '#eeeede');
  gradient.addColorStop(0.22, '#cecdc8');
  gradient.addColorStop(0.68, '#f6f6f3');
  gradient.addColorStop(1, '#fefefd');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 224);
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.strokeStyle = '#454a42';
  ctx.lineWidth = 32;
  ctx.beginPath();
  ctx.moveTo(12, 204);
  ctx.bezierCurveTo(210, 14, 300, 100, 226, 210);
  ctx.bezierCurveTo(170, 108, 140, 80, 12, 204);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = C.route;
  ctx.fillRect(0, 224, 1280, 16);
  ctx.fillStyle = '#d5d5cc';
  ctx.fillRect(0, 240, 1280, 2);
  if (panel === 0) {
    drawRingBadge(ctx, targetStation(model).code, 1044, 18, 226, C.route);
  } else {
    ctx.fillStyle = '#cbccc5';
    ctx.beginPath();
    ctx.roundRect(1160, 16, 108, 196, 9);
    ctx.fill();
    ctx.strokeStyle = '#92958c';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawFittedText(ctx, 'Car No.', 1214, 48, 98, 32, 24, C.ink, 400, LATIN_FONT, 'center');
    drawFittedText(
      ctx,
      String(model.currentCar),
      1214,
      122,
      98,
      108,
      66,
      C.ink,
      700,
      LATIN_FONT,
      'center',
    );
    drawFittedText(ctx, '号車', 1214, 185, 98, 32, 20, C.ink, 500, JAPANESE_FONT, 'center');
  }
}

export function drawHeaderText(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  panel: 0 | 1,
  language: ScreenLanguage,
): void {
  const current = targetStation(model),
    destination = destinationName(model, language);
  const japanese = language === 'ja' || language === 'kana';
  const caption = ['emergency', 'suspended'].includes(model.snapshot.state)
    ? phrase(language, model.snapshot.state)
    : ['approaching', 'arriving'].includes(model.snapshot.state)
      ? japanese
        ? 'まもなく'
        : language === 'en'
          ? 'Soon'
          : phrase(language, 'approaching')
      : ['stopped', 'doorsClosing'].includes(model.snapshot.state)
        ? japanese
          ? 'ただいま'
          : language === 'en'
            ? 'Now at'
            : phrase(language, 'stopped')
        : japanese
          ? 'つぎは'
          : phrase(language, 'cruising');
  const name = stationName(current, language);
  if (panel === 0) {
    drawFittedText(
      ctx,
      caption,
      1012,
      57,
      490,
      62,
      28,
      '#51524c',
      700,
      fontFamily(language),
      'right',
    );
    drawFittedText(
      ctx,
      name,
      1012,
      156,
      720,
      japanese ? 138 : 150,
      54,
      C.ink,
      japanese ? 900 : 700,
      fontFamily(language),
      'right',
    );
    if (language === 'en') {
      drawFittedText(ctx, 'For', 18, 133, 340, 58, 28, '#30332d', 700, LATIN_FONT);
      drawFittedText(ctx, destination, 18, 190, 520, 58, 28, '#30332d', 700, LATIN_FONT);
    } else {
      drawFittedText(
        ctx,
        destination + (japanese ? ' ゆき' : ''),
        18,
        195,
        480,
        52,
        24,
        '#30332d',
        700,
        fontFamily(language),
      );
    }
  } else {
    drawFittedText(ctx, caption, 30, 47, 900, 60, 26, '#30332d', 700, fontFamily(language));
    drawFittedText(
      ctx,
      language === 'ja' && [...name].length === 2 ? [...name].join('　') : name,
      30,
      146,
      1110,
      132,
      54,
      C.ink,
      japanese ? 900 : 700,
      fontFamily(language),
    );
    drawFittedText(
      ctx,
      (language === 'en' ? 'For ' : '') + destination + (japanese ? ' ゆき' : ''),
      1140,
      194,
      580,
      54,
      24,
      '#30332d',
      700,
      fontFamily(language),
      'right',
    );
  }
}
