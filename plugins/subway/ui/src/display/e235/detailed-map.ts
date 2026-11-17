import type { ScreenSchedule } from '../../rendering/screens';
import { e235Minutes } from './data';
import {
  ACTIVE,
  E235_HEIGHT,
  E235_WIDTH,
  HEADER,
  LINE,
  LINE_EDGE,
  MARKER_RED,
  MEIRYO,
  SANS,
  YELLOW,
  displayName,
  e235Target,
  langOf,
  numbering,
  opposite,
  stopped,
  svg,
  text,
} from './draw';
import { drawE235DetailedTransfers } from './transfers';

/** Five rows from the bottom: circle centre, diameter, minute font, name width and its vertical nudge. */
const ROWS = [
  { cx: 367, cy: 294, d: 72, font: 45, width: 272, dy: -4, gap: 52 },
  { cx: 441.5, cy: 208, d: 59, font: 38, width: 236, dy: -8, gap: 64 },
  { cx: 522, cy: 140, d: 52, font: 32, width: 204, dy: -18, gap: 57 },
  { cx: 605, cy: 91, d: 46, font: 28, width: 181, dy: -25, gap: 40 },
  { cx: 686, cy: 53, d: 44, font: 24, width: 163, dy: -30, gap: 32 },
];

export function drawE235Detailed(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const lang = langOf(model),
    mirror = opposite(model);
  const mx = (x: number) => (mirror ? E235_WIDTH - x : x);
  ctx.save();
  ctx.translate(0, HEADER);
  // The edge stroke's square end would otherwise poke above the map into the header.
  ctx.beginPath();
  ctx.rect(0, 0, E235_WIDTH, E235_HEIGHT - HEADER);
  ctx.clip();
  if (mirror) {
    ctx.translate(E235_WIDTH, 0);
    ctx.scale(-1, 1);
  }
  const band = svg('M250,380 A1000,600 0 0 1 750,0 L960,0 A900,500 0 0 0 400,380 Z'),
    edge = svg('M960,0 A900,500 0 0 0 400,380');
  if (band && edge) {
    ctx.fillStyle = LINE;
    ctx.fill(band);
    ctx.strokeStyle = LINE_EDGE;
    ctx.lineWidth = 5;
    ctx.stroke(edge);
  }
  ctx.restore();
  const isStopped = stopped(model);
  const first = isStopped ? model.station : e235Target(model);
  const startIndex = Math.max(
    0,
    model.route.findIndex((s) => s.code === first.code),
  );
  const stations = model.route.slice(startIndex, startIndex + 5);
  stations.forEach((station, i) => {
    const row = ROWS[i],
      x = mx(row.cx),
      y = HEADER + row.cy;
    if (!(i === 0 && isStopped)) {
      ctx.fillStyle = i === 0 ? YELLOW : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, row.d / 2, 0, Math.PI * 2);
      ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      text(
        ctx,
        String(e235Minutes(model.snapshot, model.route).get(station.code) ?? ''),
        x,
        y + 2,
        row.font,
        SANS,
        ACTIVE,
        { weight: 700, align: 'center', baseline: 'middle', maxWidth: row.d - 6 },
      );
    }
    // Name block: numbering (68x70 scaled to 60 high) next to the circle, then the name, scaled to the row width.
    const scale = row.width / 271,
      edge = x + (mirror ? 1 : -1) * (row.d / 2 + row.gap);
    const nameColor = ACTIVE,
      nameY = y + row.dy;
    const badgeW = 58 * scale,
      badgeX = mirror ? edge : edge - badgeW;
    numbering(ctx, station.code, badgeX, nameY - 30 * scale, (60 / 70) * scale);
    const name = displayName(station, lang === 'en' ? 'en' : 'ja', 'DetailedRouteMap');
    const family = lang === 'en' ? SANS : MEIRYO,
      size = 60 * scale,
      room = 210 * scale;
    if (name.includes('\n')) {
      // Viewbox 210x75 Stretch="Fill": the multi-line block (60px lines, Margin "0,-8") is scaled to fill the box exactly,
      // independently on each axis.
      const lines = name.split('\n'),
        boxW = room,
        boxH = 75 * scale,
        lineH = 48.5; // measured from NextStation: 0.74 vertical fill, 36px line pitch, 32px cap height
      ctx.font = `700 60px ${family}`;
      const indent = (k: number) => (k % 2 === 1 ? 100 : 0); // AlternationIndex 1 shows the 100px Spacer
      const contentW = Math.max(...lines.map((line, k) => indent(k) + ctx.measureText(line).width)),
        contentH = (lines.length - 1) * lineH + 53;
      const right = mirror ? badgeX + badgeW + 3 * scale + boxW : badgeX - 3 * scale;
      ctx.save();
      ctx.translate(right - boxW, nameY - boxH / 2 + 4);
      ctx.scale(boxW / contentW, boxH / contentH);
      lines.forEach((line, k) =>
        text(ctx, line, indent(k), 43 + k * lineH, 60, family, ACTIVE, { weight: 700 }),
      );
      ctx.restore();
      return;
    }
    const chars = [...name];
    const nameX = mirror ? badgeX + badgeW + 3 * scale : badgeX - 3 * scale;
    if (lang !== 'en' && chars.length === 2) {
      // AdvanceWidth 200: the first glyph sits against the badge, the second 120px (at row scale) further out.
      const sign = mirror ? 1 : -1;
      chars.forEach((ch, k) =>
        text(
          ctx,
          ch,
          nameX + sign * (30 + 120 * k) * scale,
          nameY + size * 0.36,
          size,
          family,
          nameColor,
          { weight: 700, align: 'center' },
        ),
      );
    } else
      text(ctx, name, nameX, nameY + size * 0.36, size, family, nameColor, {
        weight: 700,
        align: mirror ? 'left' : 'right',
        maxWidth: room,
      });
  });
  drawE235DetailedTransfers(ctx, model, mirror);
  const caption =
    lang === 'en'
      ? 'Transfer and waiting times are not included. Times may differ by train.'
      : 'のりかえ、待合わせ時間は含まれません。電車により多少時間が異なります。';
  text(
    ctx,
    caption,
    mirror ? 16 : E235_WIDTH - 16,
    E235_HEIGHT - 6,
    lang === 'en' ? 13 : 12,
    lang === 'en' ? SANS : MEIRYO,
    ACTIVE,
    { align: mirror ? 'left' : 'right' },
  );
}

/** DetailedRouteMap cursor: chevron rotated 26° sliding up the line (1.3s), or the pulsing stopping marker. */
export function detailedMarker(ctx: CanvasRenderingContext2D, model: ScreenSchedule, time: number) {
  ctx.save();
  ctx.translate(0, HEADER);
  if (opposite(model)) {
    ctx.translate(E235_WIDTH, 0);
    ctx.scale(-1, 1);
  }
  const ox = 380,
    oy = 360;
  if (stopped(model)) {
    const t = (time % 1000) / 1000,
      h = t < 0.5 ? 86 + 20 * t : 96 - 20 * (t - 0.5);
    // RenderTransformOrigin="1,1": Rotate 30, then ScaleY .8, then TranslateY -10, all about the box's bottom-right corner.
    ctx.translate(ox, oy);
    ctx.translate(0, -10);
    ctx.scale(1, 0.8);
    ctx.rotate((30 * Math.PI) / 180);
    ctx.translate(-ox, -oy);
    const house = (s: number) => {
      ctx.beginPath();
      [
        [0, 100],
        [0, 15],
        [40, 0],
        [80, 15],
        [80, 100],
      ].forEach(([px, py], i) => {
        const X = 300 + 40 + (px - 40) * s,
          Y = 260 + 50 + (py - 50) * s;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.closePath();
    };
    ctx.fillStyle = '#ffffff';
    house(1);
    ctx.fill();
    ctx.fillStyle = MARKER_RED;
    house(h / 100);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(340, 310, 12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const t = (time % 1300) / 1000,
      ty = t < 0.6 ? 85 - (33 * t) / 0.6 : 52;
    ctx.globalAlpha = Math.min(1, t / 0.2, t < 1 ? 1 : 1 - (t - 1) / 0.3);
    ctx.translate(ox, oy);
    ctx.rotate((26 * Math.PI) / 180);
    ctx.translate(-ox, -oy);
    ctx.translate(0, ty);
    ctx.beginPath();
    [
      [0, 14],
      [37.5, 0],
      [75, 14],
      [75, 40],
      [37.5, 26],
      [0, 40],
    ].forEach(([px, py], i) => {
      const X = 302.5 + px,
        Y = 290 + py;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = MARKER_RED;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}
