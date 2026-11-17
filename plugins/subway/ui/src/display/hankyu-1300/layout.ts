import { localizedName, type StationDefinition } from '../../simulation/lines';
import type { ScreenLanguage } from '../../rendering/screens';
import { drawSignBadge } from '../../icons/badge';
import { iconFor } from '../../icons/catalogue';
import { drawFittedText } from '../../rendering/lcd/shared';
import { fontFamily, nameOf } from './model';

export const SAKAISUJI_LCD_WIDTH = 1920;
export const SAKAISUJI_LCD_HEIGHT = 540;
export const SAKAISUJI_HEADER_HEIGHT = 108;
export const SAKAISUJI_COLORS = Object.freeze({
  header: '#744020',
  route: '#bc782d',
  next: '#d8e590',
  white: '#fbfcfc',
  ink: '#23292c',
  past: '#b9bec0',
  body: '#f8f7f4',
  dark: '#4d2918',
  caution: '#efd83d',
});

const C = SAKAISUJI_COLORS;

export function fillRounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
}

export function drawVerticalName(
  ctx: CanvasRenderingContext2D,
  station: StationDefinition,
  language: ScreenLanguage,
  x: number,
  y = 150,
  size = 46,
  maxHeight = 166,
): void {
  const name = nameOf(station, language);
  if (language !== 'ja' && language !== 'kana') {
    drawFittedText(
      ctx,
      name,
      x,
      y + maxHeight / 2,
      152,
      24,
      15,
      C.ink,
      700,
      fontFamily(language),
      'center',
    );
    return;
  }
  const chars = [...name];
  const charHeight = Math.min(size, maxHeight / Math.max(1, chars.length));
  chars.forEach((char, index) =>
    drawFittedText(
      ctx,
      char,
      x,
      y + charHeight * (index + 0.5),
      54,
      charHeight,
      Math.min(20, charHeight),
      C.ink,
      700,
      fontFamily(language),
      'center',
    ),
  );
}

const OSAKA_LINES: readonly [RegExp, string][] = [
  [/^T\d|Tanimachi/i, 'osaka-metro/t'],
  [/^C\d|Chuo/i, 'osaka-metro/c'],
  [/^N\d|Nagahori/i, 'osaka-metro/n'],
  [/^M\d|Midosuji/i, 'osaka-metro/m'],
  [/^S\d|Sennichimae/i, 'osaka-metro/s'],
];

function transferColor(code: string): string {
  const id =
    OSAKA_LINES.find(([pattern]) => pattern.test(code))?.[1] ??
    (/JR|Keihan/i.test(code) ? 'generic/jr-keihan' : 'generic/other');
  return iconFor(id).color;
}

export function drawTransfers(
  ctx: CanvasRenderingContext2D,
  station: StationDefinition,
  language: ScreenLanguage,
  x: number,
  y: number,
): void {
  const transfers = station.transfers.slice(0, 3);
  if (!transfers.length) {
    return;
  }
  let offset = 0;
  for (const transfer of transfers) {
    if (transfer.kind === 'badge') {
      drawSignBadge(ctx, transfer.code, x - 18 + offset, y - 13, 36, transferColor(transfer.code));
      offset += 40;
    } else {
      const text = localizedName(
        transfer.names,
        language,
        transfer.names.ja ?? transfer.names.en ?? '',
      );
      drawFittedText(
        ctx,
        text,
        x,
        y + offset,
        164,
        18,
        12,
        transferColor(text),
        600,
        fontFamily(language),
        'center',
      );
      offset += 20;
    }
  }
}

export function drawDirectionArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: 1 | -1,
): void {
  ctx.strokeStyle = '#f8faf4';
  ctx.fillStyle = '#d7e574';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x - direction * 18, y);
  ctx.lineTo(x + direction * 18, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + direction * 30, y);
  ctx.lineTo(x + direction * 12, y - 13);
  ctx.lineTo(x + direction * 12, y + 13);
  ctx.closePath();
  ctx.fill();
}
