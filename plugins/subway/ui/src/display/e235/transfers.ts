import type { ScreenSchedule } from '../../rendering/screens';
import { e235Station, e235TransferLayout } from './data';
import { drawIcon } from '../../icons/paint';
import { JA, SANS, label } from './page-draw';
import { target } from './stop';

export function drawE235DetailedTransfers(
  ctx: CanvasRenderingContext2D,
  model: ScreenSchedule,
  mirror: boolean,
) {
  const station = e235Station(target(model));
  const layout = e235TransferLayout(
    station.code,
    model.snapshot.direction,
    'DetailedRouteMap',
    model.language,
  );
  if (!layout.lines.length) return;
  const en = model.language === 'en',
    left = mirror ? 10 : 600,
    anchor = mirror ? left : 950;
  const align = mirror ? 'left' : 'right';
  label(
    ctx,
    en ? 'Transfer at' : `${station.names.ja}駅`,
    anchor,
    265,
    24,
    350,
    en ? '#a0a0a0' : '#000000',
    en ? SANS : JA,
    en ? 400 : 700,
    align,
  );
  label(
    ctx,
    en ? `${station.names.en} Station` : '乗換えのご案内',
    anchor,
    290,
    24,
    350,
    en ? '#000000' : '#a0a0a0',
    en ? SANS : JA,
    en ? 700 : 400,
    align,
  );
  const rows = Array.from({ length: layout.rows! }, () => 30);
  for (const item of layout.lines) {
    const name = en ? item.aliasEn || item.transfer.en : item.aliasJa || item.transfer.ja;
    rows[item.row!] = Math.max(rows[item.row!]!, name.split('\n').length * 25 + 5);
  }
  const col = 330 / layout.columns!;
  for (const item of layout.lines) {
    const column = item.column!;
    const x = left + (mirror ? 0 : 20) + column * col + 2;
    const y = 300 + rows.slice(0, item.row!).reduce((a, b) => a + b, 0);
    const icon = item.transfer.icons[item.iconRef ?? model.iconPhase % item.transfer.icons.length];
    if (icon) drawIcon(ctx, icon, x, y, 24);
    const name = en ? item.aliasEn || item.transfer.en : item.aliasJa || item.transfer.ja;
    name
      .split('\n')
      .forEach((line, i) =>
        label(
          ctx,
          line,
          x + 29,
          y + 20 + 25 * i,
          24,
          col * (item.columnSpan ?? 1) - 40,
          '#000000',
          en ? SANS : JA,
        ),
      );
  }
}
