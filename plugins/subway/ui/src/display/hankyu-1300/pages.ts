import type { ScreenSchedule } from '../../rendering/screens';
import { drawSignBadge } from '../../icons/badge';
import { drawFittedText, JAPANESE_FONT } from '../../rendering/lcd/shared';
import {
  fontFamily,
  nameOf,
  sakaisujiCarOrder,
  sakaisujiNearbyStations,
  sakaisujiOrderedStations,
} from './model';
import {
  SAKAISUJI_COLORS as C,
  SAKAISUJI_LCD_WIDTH,
  SAKAISUJI_LCD_HEIGHT,
  SAKAISUJI_HEADER_HEIGHT,
  drawVerticalName,
  drawTransfers,
  drawDirectionArrow,
  fillRounded,
} from './layout';

function drawBroad(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(
    0,
    SAKAISUJI_HEADER_HEIGHT,
    SAKAISUJI_LCD_WIDTH,
    SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT,
  );
  const stations = sakaisujiOrderedStations(model);
  const currentIndex = stations.findIndex((station) => station.code === model.snapshot.station);
  const nextIndex = stations.findIndex((station) => station.code === model.snapshot.next);
  const left = 104,
    gap = 190,
    y = 370;
  ctx.strokeStyle = C.route;
  ctx.lineWidth = 58;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left + gap * (stations.length - 1), y);
  ctx.stroke();
  stations.forEach((station, index) => {
    const x = left + gap * index;
    const past = index < currentIndex;
    drawVerticalName(ctx, station, model.language, x, 144, 40, 170);
    const fill =
      index === currentIndex ? C.header : index === nextIndex ? C.next : past ? C.past : C.white;
    ctx.fillStyle = fill;
    ctx.strokeStyle = C.route;
    ctx.lineWidth = index === currentIndex || index === nextIndex ? 6 : 3;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawSignBadge(ctx, station.code, x - 34, y - 34, 68, index === nextIndex ? '#c7dc63' : C.route);
    drawTransfers(ctx, station, model.language, x, 430);
  });
  if (nextIndex >= 0) {
    drawDirectionArrow(ctx, left + gap * nextIndex - 100, y, 1);
  }
}

function drawNearby(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(
    0,
    SAKAISUJI_HEADER_HEIGHT,
    SAKAISUJI_LCD_WIDTH,
    SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT,
  );
  const stations = sakaisujiNearbyStations(model);
  const ordered = sakaisujiOrderedStations(model);
  const currentIndex = ordered.findIndex((station) => station.code === model.snapshot.station);
  const left = 160,
    gap = 320,
    y = 360;
  ctx.strokeStyle = C.route;
  ctx.lineWidth = 58;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left + gap * (stations.length - 1), y);
  ctx.stroke();
  stations.forEach((station, index) => {
    const x = left + gap * index;
    const current = station.code === model.snapshot.station;
    const next = station.code === model.snapshot.next;
    const past =
      !current && !next && ordered.findIndex((item) => item.code === station.code) < currentIndex;
    drawVerticalName(ctx, station, model.language, x, 164, 42, 162);
    ctx.fillStyle = current ? C.header : next ? C.next : past ? C.past : C.white;
    ctx.strokeStyle = C.route;
    ctx.lineWidth = current || next ? 6 : 3;
    ctx.beginPath();
    ctx.arc(x, y, current || next ? 38 : 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawSignBadge(ctx, station.code, x - 38, y - 38, 76, next ? '#c7dc63' : C.route);
    drawTransfers(ctx, station, model.language, x, 426);
  });
  const nextIndex = stations.findIndex((station) => station.code === model.snapshot.next);
  if (nextIndex >= 0) {
    drawDirectionArrow(ctx, left + gap * nextIndex - 148, y, 1);
  }
}

function drawDoorGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  doors: string,
): void {
  ctx.fillStyle = C.white;
  ctx.fillRect(x, y, width, height);
  const center = x + width / 2,
    gap = doors === 'open' ? width * 0.24 : 8;
  ctx.fillStyle = '#c9b8a8';
  ctx.fillRect(x + 12, y + 12, width / 2 - gap / 2 - 12, height - 24);
  ctx.fillRect(center + gap / 2, y + 12, width / 2 - gap / 2 - 12, height - 24);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 12, y + 12, width - 24, height - 24);
  ctx.beginPath();
  ctx.moveTo(center, y + 12);
  ctx.lineTo(center, y + height - 12);
  ctx.stroke();
}

function drawPlatform(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  const station =
    model.snapshot.state === 'approaching' ? (model.nextStation ?? model.station) : model.station;
  ctx.fillStyle = C.body;
  ctx.fillRect(
    0,
    SAKAISUJI_HEADER_HEIGHT,
    SAKAISUJI_LCD_WIDTH,
    SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT,
  );
  drawFittedText(
    ctx,
    `${station.code}  ${nameOf(station, model.language)}`,
    72,
    148,
    1760,
    50,
    36,
    C.ink,
    700,
    fontFamily(model.language),
  );
  const cars = sakaisujiCarOrder(model);
  const left = 78,
    top = 230,
    gap = 12,
    width = (1764 - gap * 7) / 8;
  cars.forEach((car, index) => {
    const x = left + index * (width + gap);
    ctx.fillStyle = car === 1 ? C.header : C.white;
    ctx.strokeStyle = C.route;
    ctx.lineWidth = 3;
    ctx.fillRect(x, top, width, 82);
    ctx.strokeRect(x + 1.5, top + 1.5, width - 3, 79);
    drawFittedText(
      ctx,
      String(car),
      x + width / 2,
      top + 41,
      width - 8,
      28,
      18,
      car === 1 ? C.white : C.ink,
      700,
      'Arial, sans-serif',
      'center',
    );
  });
  ctx.fillStyle = '#f2eadf';
  ctx.fillRect(0, 354, SAKAISUJI_LCD_WIDTH, 180);
  fillRounded(ctx, 68, 374, 174, 44, C.next);
  const sideText =
    model.snapshot.state === 'approaching' || !model.sideLabel
      ? model.language === 'kana'
        ? 'どあ'
        : 'ドア'
      : model.sideLabel === 'this side'
        ? model.language === 'kana'
          ? 'こちらがわ'
          : 'こちら側'
        : model.sideLabel === 'opposite side'
          ? model.language === 'kana'
            ? 'はんたいがわ'
            : '反対側'
          : model.language === 'kana'
            ? 'りょうがわ'
            : '両側';
  drawFittedText(
    ctx,
    sideText,
    155,
    396,
    150,
    28,
    19,
    C.ink,
    700,
    fontFamily(model.language),
    'center',
  );
  drawDoorGlyph(ctx, 296, 370, 206, 144, model.snapshot.doors);
  const doorState =
    model.snapshot.state === 'approaching'
      ? '停車後にドアが開きます'
      : model.snapshot.doors === 'open'
        ? 'ドアが開いています'
        : 'ドアが閉まっています';
  const kanaDoorState =
    model.snapshot.state === 'approaching'
      ? 'ていしゃごにドアがあきます'
      : model.snapshot.doors === 'open'
        ? 'ドアがあいています'
        : 'ドアがしまっています';
  drawFittedText(
    ctx,
    model.language === 'kana' ? kanaDoorState : doorState,
    548,
    432,
    980,
    34,
    24,
    C.ink,
    600,
    fontFamily(model.language),
  );
}

function drawTransferDetail(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(
    0,
    SAKAISUJI_HEADER_HEIGHT,
    SAKAISUJI_LCD_WIDTH,
    SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT,
  );
  drawFittedText(
    ctx,
    model.language === 'kana' ? 'のりかえあんない' : '乗り換え案内',
    80,
    162,
    800,
    42,
    30,
    C.ink,
    700,
    fontFamily(model.language),
  );
  drawFittedText(
    ctx,
    `${model.transferStation.code}  ${nameOf(model.transferStation, model.language)}`,
    80,
    224,
    1100,
    56,
    42,
    C.ink,
    700,
    fontFamily(model.language),
  );
  model.transfers.slice(0, 8).forEach((transfer, index) => {
    const x = 112 + (index % 4) * 440,
      y = 332 + Math.floor(index / 4) * 98;
    if (/^[A-Z]{1,3}\d{2}$/.test(transfer)) {
      drawSignBadge(ctx, transfer, x, y - 25, 52, C.route);
    } else {
      drawFittedText(ctx, transfer, x + 76, y, 332, 32, 20, C.ink, 700, fontFamily(model.language));
    }
  });
}

function drawIncident(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  ctx.fillStyle = C.body;
  ctx.fillRect(
    0,
    SAKAISUJI_HEADER_HEIGHT,
    SAKAISUJI_LCD_WIDTH,
    SAKAISUJI_LCD_HEIGHT - SAKAISUJI_HEADER_HEIGHT,
  );
  ctx.fillStyle = C.caution;
  ctx.fillRect(0, SAKAISUJI_HEADER_HEIGHT, SAKAISUJI_LCD_WIDTH, 8);
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(154, 190);
  ctx.lineTo(258, 408);
  ctx.lineTo(50, 408);
  ctx.closePath();
  ctx.fill();
  drawFittedText(ctx, '!', 154, 342, 94, 92, 76, C.white, 700, 'Arial, sans-serif', 'center');
  const messages =
    model.page === 'emergency'
      ? ['緊急停止', 'Emergency stop']
      : ['運転見合わせ', 'Service suspended'];
  messages.forEach((message, index) =>
    drawFittedText(
      ctx,
      message,
      340,
      238 + index * 86,
      1280,
      56,
      38,
      index ? C.ink : C.header,
      700,
      index ? 'Arial, sans-serif' : JAPANESE_FONT,
    ),
  );
}

export function drawPage(ctx: CanvasRenderingContext2D, model: ScreenSchedule): void {
  if (model.page === 'emergency' || model.page === 'suspension') {
    drawIncident(ctx, model);
  } else if (model.page === 'platform' || model.page === 'closing') {
    drawPlatform(ctx, model);
  } else if (model.page === 'transfers') {
    drawTransferDetail(ctx, model);
  } else if (model.page === 'nearby') {
    drawNearby(ctx, model);
  } else {
    drawBroad(ctx, model);
  }
}
