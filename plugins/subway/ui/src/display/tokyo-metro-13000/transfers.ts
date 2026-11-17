import type { ScreenSchedule } from '../../rendering/screens';
import type { StationDefinition } from '../../simulation/lines';
import { drawIcon } from '../../icons/paint';
import { iconFor } from '../../icons/catalogue';
import type { PaintedIcon } from '../../icons/contracts';
import { drawFittedText } from './text';
import { C, HEADER_BOTTOM, LATIN_FONT, HIBIYA_PANEL_WIDTH } from './layout';
type TransferSign = { icon: PaintedIcon; ja: string; en: string };

/** Display transfer code prefix to catalogue id. */
const TRANSFER_ICON_IDS: Record<string, string> = {
  G: 'tokyo-metro/g',
  M: 'tokyo-metro/m',
  C: 'tokyo-metro/c',
  Y: 'tokyo-metro/y',
  T: 'tokyo-metro/t',
  Z: 'tokyo-metro/z',
  A: 'toei/a',
  E: 'toei/e',
  I: 'toei/i',
  S: 'toei/s',
  TY: 'tokyu/ty',
  JE: 'jr-east/je',
  JJ: 'jr-east/jj',
  TX: 'mir/tx',
  TS: 'tobu/ts',
};

function catalogueSign(id: string): TransferSign {
  const icon = iconFor(id);
  return { icon, ja: icon.names!.ja, en: icon.names!.en };
}

/** Operators outside the catalogue get a plain square sign instead of a silent substitute. */
function plainSign(letter: string, color: string, ja: string, en: string): TransferSign {
  return { icon: { shape: 'square', letter, color }, ja, en };
}

export function routeTransfers(station: StationDefinition): TransferSign[] {
  return station.transfers
    .flatMap((item) => {
      if (item.kind === 'badge') {
        const prefix = item.code.replace(/\d+$/, '');
        const id = TRANSFER_ICON_IDS[prefix];
        return [id ? catalogueSign(id) : plainSign(prefix, '#263642', prefix, prefix)];
      }
      return (item.names.ja ?? item.names.en ?? '')
        .split(/[・、,]/)
        .filter(Boolean)
        .map((ja) =>
          ja.includes('つくば')
            ? catalogueSign(TRANSFER_ICON_IDS.TX!)
            : plainSign(
                ja.includes('JR') ? 'JR' : '',
                ja.includes('京成') ? '#277ca3' : '#2b7364',
                ja,
                item.names.en ?? ja,
              ),
        );
    })
    .filter((item, index, list) => list.findIndex((sign) => sign.ja === item.ja) === index);
}

export function drawTransferDetail(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 720 - HEADER_BOTTOM);
  ctx.fillStyle = '#e3e4de';
  ctx.fillRect(0, HEADER_BOTTOM, HIBIYA_PANEL_WIDTH, 52);
  drawFittedText(ctx, 'のりかえのご案内 / Transfer information', 30, 268, 1220, 32, 24, C.ink, 500);
  routeTransfers(model.transferStation)
    .slice(0, 5)
    .forEach((sign, index) => {
      const y = 324 + index * 74;
      drawIcon(ctx, sign.icon, 56, y, 52);
      drawFittedText(ctx, sign.ja, 132, y + 14, 1060, 36, 24, C.ink, 700);
      drawFittedText(ctx, sign.en, 132, y + 48, 1060, 28, 18, C.ink, 500, LATIN_FONT);
    });
}
