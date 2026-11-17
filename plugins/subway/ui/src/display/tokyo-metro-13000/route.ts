import type { ScreenSchedule } from '../../rendering/screens';
import { stationMinutes } from '../../rendering/screens';
import { hibiyaPanelStations, hibiyaRouteWindow } from './model';
import { drawIcon } from '../../icons/paint';
import { routeTransfers } from './transfers';
import { drawFittedText, stationName } from './text';
import {
  C,
  HEADER_BOTTOM,
  JAPANESE_FONT,
  LATIN_FONT,
  HIBIYA_PANEL_WIDTH,
  HIBIYA_MULLION_WIDTH,
} from './layout';
export function drawRoutePanel(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  panel: 0 | 1,
): void {
  const stations = hibiyaPanelStations(hibiyaRouteWindow(model), panel);
  ctx.fillStyle = C.body;
  ctx.fillRect(0, HEADER_BOTTOM, 1280, 720 - HEADER_BOTTOM);
  const rail = ctx.createLinearGradient(0, 484, 0, 544);
  rail.addColorStop(0, '#b9b9b2');
  rail.addColorStop(0.45, '#d9d9d4');
  rail.addColorStop(0.49, '#a3a49c');
  rail.addColorStop(1, '#b4b4ab');
  ctx.fillStyle = rail;
  ctx.fillRect(0, 484, 1280, 60);
  ctx.strokeStyle = '#97998c';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 484, 1280, 60);
  const ordered =
    model.line.directions.find((d) => d.id === model.snapshot.direction)?.delta === -1
      ? [...model.line.stations].reverse()
      : model.line.stations;
  const currentPosition = ordered.findIndex((s) => s.code === model.snapshot.station);
  stations.forEach((station, index) => {
    const x = 150 + 140 * index;
    const position = ordered.findIndex((s) => s.code === station.code);
    const past = position < currentPosition;
    ctx.save();
    if (past || station.code === model.snapshot.station) {
      ctx.globalAlpha = 0.48;
    }
    const name = [...stationName(station, 'ja')],
      size = name.length > 4 ? 40 : 50;
    const top = name.length > 3 ? 270 : 320,
      bottom = 434;
    name.forEach((char, i) =>
      drawFittedText(
        ctx,
        char,
        x,
        top + ((bottom - top) * i) / Math.max(1, name.length - 1),
        76,
        size,
        26,
        C.ink,
        700,
        JAPANESE_FONT,
        'center',
      ),
    );
    drawFittedText(
      ctx,
      station.code.replace(/([A-Z]+)(\d+)/, '$1-$2'),
      x,
      470,
      132,
      29,
      20,
      C.ink,
      700,
      LATIN_FONT,
      'center',
    );
    const box = ctx.createLinearGradient(0, 490, 0, 538);
    box.addColorStop(0, '#ffffff');
    box.addColorStop(1, '#e5e5dd');
    ctx.fillStyle = box;
    ctx.fillRect(x - 36, 490, 72, 48);
    if (position > currentPosition) {
      drawFittedText(
        ctx,
        String(stationMinutes(model, station.code) ?? ''),
        x,
        515,
        70,
        54,
        26,
        C.ink,
        700,
        LATIN_FONT,
        'center',
      );
    }
    routeTransfers(station)
      .slice(0, 5)
      .forEach((sign, i) => {
        drawIcon(ctx, sign.icon, x - 65, 552 + i * 23, 20);
        drawFittedText(ctx, sign.ja, x - 40, 562 + i * 23, 150, 18, 13, C.ink, 600);
      });
    ctx.restore();
  });
  if (panel === 1) {
    drawFittedText(ctx, '(分)', 1226, 523, 50, 22, 18, C.white, 500);
    drawFittedText(
      ctx,
      '運転状況により、多少時間は異なります。',
      1260,
      695,
      1180,
      30,
      18,
      C.ink,
      500,
      JAPANESE_FONT,
      'right',
    );
  }
}

export function drawPosition(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  panel: 0 | 1,
  elapsed: number,
): void {
  const stations = hibiyaPanelStations(hibiyaRouteWindow(model), panel);
  const index = stations.findIndex((s) => s.code === model.snapshot.station);
  if (index < 0) {
    return;
  }
  const stopped =
    !model.nextStation || ['stopped', 'arriving', 'doorsClosing'].includes(model.snapshot.state);
  const x = 150 + 140 * index + (stopped ? 0 : 70);
  ctx.save();
  ctx.translate(panel * (HIBIYA_PANEL_WIDTH + HIBIYA_MULLION_WIDTH), 0);
  ctx.globalAlpha = stopped ? 1 : elapsed % 1_000 < 650 ? 1 : 0.2;
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 5;
  ctx.fillStyle = '#1c5098';
  ctx.beginPath();
  ctx.moveTo(x - 28, 484);
  ctx.lineTo(x + 4, 514);
  ctx.lineTo(x - 28, 544);
  ctx.lineTo(x - 2, 544);
  ctx.lineTo(x + 30, 514);
  ctx.lineTo(x - 2, 484);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
