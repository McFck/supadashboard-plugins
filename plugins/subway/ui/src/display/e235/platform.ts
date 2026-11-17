import type { ScreenSchedule } from '../../rendering/screens';
import { e235Station, e235TransferLayout } from './data';
import { e235Images } from './images';
import { drawIcon } from '../../icons/paint';
import { SANS, carBody, label, polygon } from './page-draw';
import { stopFor, target, thisSide } from './stop';

type PlatformObject = ReturnType<
  typeof e235Station
>['platforms'][number]['blocks'][number]['units'][number]['groups'][number]['objects'][number];
export function e235PackPlatformObjects(objects: readonly PlatformObject[]) {
  const packed: PlatformObject[][] = [];
  for (let i = 0; i < objects.length; i++) {
    const first = objects[i]!,
      next = objects[i + 1];
    const pair =
      next &&
      first.direction === next.direction &&
      first.position === next.position &&
      first.key?.startsWith('Up') === next.key?.startsWith('Up') &&
      /Stairs|Escalator/.test(first.key!) &&
      /Stairs|Escalator/.test(next.key!) &&
      first.key !== next.key;
    packed.push(pair ? [first, objects[++i]!] : [first]);
  }
  return packed;
}

export function transferGrid(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  mode: 'Transfers' | 'Platform',
) {
  const layout = e235TransferLayout(target(model), model.snapshot.direction, mode, 'ja');
  if (!layout.lines.length) return;
  const full = mode === 'Transfers',
    jaSize = full ? 38 : 28,
    enSize = full ? 24 : 16,
    iconSize = full ? 36 : 30;
  const gap = full ? 36 : 18,
    rowHeight = full ? 96 : 54;
  const widths = Array.from({ length: layout.columns! }, () => 0);
  for (const item of layout.lines) {
    ctx.font = `${jaSize}px ${SANS}`;
    const ja = ctx.measureText((item.aliasJa || item.transfer.ja).replace(/\n/g, '')).width;
    ctx.font = `${enSize}px ${SANS}`;
    const en = ctx.measureText((item.aliasEn || item.transfer.en).replace(/\n/g, '')).width;
    const width =
      (full ? 2 : 0) + iconSize + (full ? 6 : 4) + Math.min(680, Math.max(ja, en)) + gap;
    const span = item.columnSpan ?? 1;
    for (let c = item.column!; c < item.column! + span; c++)
      widths[c] = Math.max(widths[c]!, width / span);
  }
  const width = widths.reduce((a, b) => a + b, 0),
    height = layout.rows! * rowHeight;
  const scale = Math.min(1, (full ? 864 : 870) / width, (full ? 286 : 100) / height);
  ctx.save();
  ctx.translate(
    (960 - width * scale) / 2,
    full ? 214 + (286 - height * scale) / 2 : 400 + (100 - height * scale) / 2,
  );
  ctx.scale(scale, scale);
  for (const item of layout.lines) {
    const x = widths.slice(0, item.column!).reduce((a, b) => a + b, 0) + (full ? 2 : 0),
      y = item.row! * rowHeight + (full ? 0 : 5);
    const icon = item.transfer.icons[item.iconRef ?? model.iconPhase % item.transfer.icons.length];
    if (icon) drawIcon(ctx, icon, x, y, iconSize);
    const tx = x + iconSize + (full ? 6 : 4),
      room =
        widths
          .slice(item.column!, item.column! + (item.columnSpan ?? 1))
          .reduce((a, b) => a + b, 0) -
        iconSize -
        gap -
        6;
    label(
      ctx,
      (item.aliasJa || item.transfer.ja).replace(/\n/g, ''),
      tx,
      y + (full ? 32 : 25),
      jaSize,
      room,
    );
    label(
      ctx,
      (item.aliasEn || item.transfer.en).replace(/\n/g, ''),
      tx + (full ? 0 : 2),
      y + (full ? 60 : 43),
      enSize,
      room,
    );
  }
  ctx.restore();
}

/** PlatformBase, PlatformBlocks/Units, Exits and Train use the theme's 76px car pitch. */
export function drawE235Platform(ctx: CanvasRenderingContext2D, model: ScreenSchedule) {
  const station = e235Station(target(model)),
    stop = stopFor(model);
  const platform = station.platforms[stop.platformRef ?? 0]!;
  const right = (model.viewingSide ?? 'right') === 'right',
    near = thisSide(model);
  const platformWidth = platform.length! * 76,
    px = right ? 0 : 960 - platformWidth;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 160, 960, 240);
  ctx.clip();
  ctx.fillStyle = '#c0c9d0';
  ctx.fillRect(px, 206, platformWidth, 138);
  ctx.fillStyle = '#607080';
  ctx.fillRect(px, 344, platformWidth, 10);
  ctx.fillStyle = '#e0e080';
  for (let x = px; x < px + platformWidth; x += 15) {
    ctx.fillRect(x, 211, 8, 3);
    ctx.fillRect(x, 336, 8, 3);
  }
  const reverse = (model.snapshot.direction === 'outer') === right;
  const mapX = (x: number) => px + (reverse ? platformWidth - x : x);
  let offset = 0;
  for (const block of platform.blocks) {
    const base = offset;
    offset += block.length! * 76;
    block.units.forEach((unit, i) =>
      unit.groups.forEach((group) => {
        const first = group.objects[0];
        if (!first) return;
        const pos =
          first.position === 'Front'
            ? 57
            : first.position === 'Back'
              ? 19
              : first.position === 'Border'
                ? 76
                : 38;
        const akihabara = station.code === 'JY03';
        const cx = mapX(base + i * 76 + pos),
          iconBottom = near ? (akihabara ? 279 : 310) : akihabara ? 324 : 296;
        const exitY = near
          ? group.targetExit && group.targetExit > 0
            ? akihabara
              ? 295
              : 255
            : 204
          : group.targetExit && group.targetExit > 0
            ? akihabara
              ? 261
              : 351
            : 356;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(
          cx - 3,
          Math.min(iconBottom - 25, exitY),
          6,
          Math.abs(exitY - (iconBottom - 25)),
        );
        ctx.fillStyle = '#000000';
        ctx.fillRect(
          cx - 1,
          Math.min(iconBottom - 25, exitY),
          2,
          Math.abs(exitY - (iconBottom - 25)),
        );
        const packed = e235PackPlatformObjects(group.objects);
        const heights: Record<string, number> = {
          UpStairs: 50,
          DownStairs: 26,
          UpEscalator: 45,
          DownEscalator: 30,
          Elevator: 60,
        };
        const itemHeights = packed.map((items) =>
          items.length === 2
            ? items[0]!.key!.startsWith('Up')
              ? 60
              : (reverse ? items[1] : items[0])!.key === 'DownStairs'
                ? 50
                : 54
            : heights[items[0]!.key!]!,
        );
        let bottom =
          iconBottom +
          (packed.length > 1 ? (near ? 22 : 35) : 0) -
          itemHeights.reduce((a, b) => a + b, 0);
        packed.forEach((items, j) => {
          const obj = items[0]!,
            height = itemHeights[j]!;
          bottom += height;
          ctx.save();
          ctx.translate(cx, bottom);
          if (obj.direction !== 'None' && (obj.direction === 'Opposite') !== reverse)
            ctx.scale(-1, 1);
          const paired = items.length === 2;
          if (paired) {
            // PlatformObjectPackingConverter combines stairs/escalators that face the same way.
            const stairsFirst = (reverse ? items[1]!.key : obj.key)!.endsWith('Stairs');
            if (obj.key!.startsWith('Up')) {
              e235Images.draw(ctx, stairsFirst ? 'UpStairs' : 'UpEscalator', -18, -60, 36, 50);
              e235Images.draw(
                ctx,
                stairsFirst ? 'UpEscalator' : 'UpStairs_small',
                -19,
                -50,
                38,
                50,
              );
            } else if (stairsFirst) {
              ctx.fillStyle = '#808080';
              ctx.fillRect(-16, -50, 34, 20);
              ctx.fillRect(-9, -50, 27, 50);
              ctx.save();
              ctx.beginPath();
              ctx.rect(-16, -50, 34, 50);
              ctx.clip();
              e235Images.draw(ctx, 'DownStairs', -19, -49, 44, 60);
              ctx.restore();
              ctx.save();
              ctx.beginPath();
              ctx.rect(-19, -50, 37, 50);
              ctx.clip();
              e235Images.draw(ctx, 'DownEscalator', -19, -32, 44, 61);
              ctx.restore();
            } else {
              ctx.fillStyle = '#808080';
              ctx.fillRect(-12, -50, 30, 40);
              ctx.save();
              ctx.beginPath();
              ctx.rect(-19, -54, 37, 50);
              ctx.clip();
              e235Images.draw(ctx, 'DownEscalator', -19, -54, 46, 64);
              ctx.restore();
              ctx.save();
              ctx.beginPath();
              ctx.rect(-16, -31, 34, 31);
              ctx.clip();
              e235Images.draw(ctx, 'DownStairs', -19, -31, 44, 60);
              ctx.restore();
            }
          } else if (obj.key === 'DownStairs') {
            ctx.fillStyle = '#808080';
            ctx.fillRect(-18, -26, 36, 26);
            ctx.beginPath();
            ctx.rect(-18, -26, 36, 26);
            ctx.clip();
            e235Images.draw(ctx, 'DownStairs', -21, -25, 45, 60);
          } else if (obj.key === 'DownEscalator') {
            ctx.beginPath();
            ctx.rect(-18, -30, 36, 30);
            ctx.clip();
            ctx.fillStyle = '#808080';
            ctx.fillRect(-6, -26, 24, 26);
            e235Images.draw(ctx, 'DownEscalator', -18, -30, 50, 55);
          } else e235Images.draw(ctx, obj.key!, -18, -height, 36, height);
          ctx.restore();
        });
      }),
    );
    block.exits.forEach((exit, i) => {
      const position = (p: string | null) =>
        p === 'Back' ? 1 : p === 'Front' ? 39 : p === 'Center' ? 20 : 58;
      const start = base + exit.offset! * 76 + position(exit.start),
        end = base + (exit.offset! + exit.length! - 1) * 76 + position(exit.end) + 36;
      const x = Math.min(mapX(start), mapX(end)),
        width = Math.abs(end - start),
        y = near
          ? i === 0
            ? 166
            : station.code === 'JY03'
              ? 295
              : 209
          : i === 0
            ? 356
            : station.code === 'JY03'
              ? 223
              : 313;
      ctx.fillStyle = '#f0f000';
      ctx.fillRect(x, y, width, 38);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 37);
      label(ctx, exit.ja, x + width / 2, y + 21, 18, width - 8, '#000000', SANS, 400, 'center');
      label(ctx, exit.en, x + width / 2, y + 34, 12, width - 8, '#000000', SANS, 400, 'center');
    });
  }
  const trainWidth = 11 * 76,
    trainX = right
      ? (stop.stopPosOffset ?? 0) * 76
      : 960 - (stop.stopPosOffset ?? 0) * 76 - trainWidth,
    trainY = near ? 357 : 167;
  for (let i = 0; i < 11; i++) {
    const car = (model.snapshot.direction === 'outer') !== right ? 11 - i : i + 1,
      selected = car === model.currentCar;
    const x = trainX + i * 76 + (selected ? 1 : 2),
      y = trainY - (selected ? 1 : 0),
      width = selected ? 74 : 72,
      height = selected ? 38 : 36;
    ctx.fillStyle = selected ? '#ffffff' : '#d0d9e0';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.6;
    carBody(ctx, x, y, width, height, i === 0, i === 10);
    ctx.fill();
    ctx.stroke();
    if (selected) {
      ctx.fillStyle = '#d00000';
      carBody(ctx, x + 3, y + 3, width - 6, height - 6, i === 0, i === 10, true);
      ctx.fill();
    }
    ctx.save();
    ctx.font = `italic 700 32px ${SANS}`;
    ctx.fillStyle = selected ? '#ffffff' : '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(car), x + width / 2 + (right ? -4 : 4), y + height / 2 + 11);
    ctx.restore();
  }
  const leftwards = right;
  const ax = leftwards ? trainX - 24 : trainX + trainWidth + 7;
  polygon(
    ctx,
    leftwards
      ? [
          [ax + 17, trainY + 3],
          [ax, trainY + 18],
          [ax + 17, trainY + 33],
        ]
      : [
          [ax, trainY + 3],
          [ax + 17, trainY + 18],
          [ax, trainY + 33],
        ],
    '#404040',
  );
  ctx.restore();
}
