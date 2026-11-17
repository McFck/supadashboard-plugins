import type { StationDefinition } from '../../simulation/lines';
import type { ScreenSchedule } from '../../rendering/screens';

export const E235_WIDTH = 960;
export const E235_HEIGHT = 540;
export const HEADER = 160;
export const LINE = '#40c000';
export const LINE_EDGE = '#00a000';
export const MARKER_RED = '#a00000';
export const YELLOW = '#ffe000';
export const ACTIVE = '#000000';
export const SANS = '"Microsoft Sans Serif", Arial, sans-serif';
export const MEIRYO = 'Meiryo, "Meiryo UI", "Yu Gothic UI", sans-serif';
export const MEIRYO_UI = '"Meiryo UI", Meiryo, "Yu Gothic UI", sans-serif';
/** <Aliases> from the E235-0 device settings: per-page display names with explicit line breaks. */
export const ALIASES: Record<
  string,
  Partial<Record<'RouteMap' | 'DetailedRouteMap', Partial<Record<'ja' | 'en', string>>>>
> = {
  JY26: {
    RouteMap: { ja: '高輪\nゲートウェイ', en: 'Takanawa\nGateway' },
    DetailedRouteMap: { en: 'Takanawa\nGateway' },
  },
};
export const displayName = (
  station: StationDefinition,
  lang: 'ja' | 'en',
  page: 'RouteMap' | 'DetailedRouteMap',
) =>
  ALIASES[station.code]?.[page]?.[lang] ??
  (lang === 'en' ? station.names.en : station.names.ja) ??
  station.code;

export type Lang = 'ja' | 'en' | 'kana';
export const langOf = (model: ScreenSchedule): Lang =>
  model.language === 'en' ? 'en' : model.language === 'kana' ? 'kana' : 'ja';
export const stopped = (model: ScreenSchedule) =>
  ['stopped', 'arriving', 'doorsClosing'].includes(model.snapshot.state);

/** The header/map "current" station: the stop while standing, otherwise the next stop. */
export function e235Target(model: ScreenSchedule): StationDefinition {
  return stopped(model) ? model.station : (model.nextStation ?? model.station);
}

/** Our station numbers rise counter-clockwise on screen, which is NextStation's "Opposite" direction. */
export const opposite = (model: ScreenSchedule) =>
  (model.line.directions.find((d) => d.id === model.snapshot.direction)?.delta ?? 1) === 1;

export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  family: string,
  color: string,
  {
    weight = 400,
    align = 'left' as CanvasTextAlign,
    baseline = 'alphabetic' as CanvasTextBaseline,
    maxWidth = 0,
    italic = false,
  } = {},
) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const width = ctx.measureText(value).width;
  if (maxWidth && width > maxWidth) {
    // WPF Viewbox Stretch="Fill" StretchDirection="DownOnly": squeeze horizontally only.
    ctx.save();
    const anchor = align === 'right' ? x : align === 'center' ? x : x;
    ctx.translate(anchor, 0);
    ctx.scale(maxWidth / width, 1);
    ctx.fillText(value, 0, y);
    ctx.restore();
  } else ctx.fillText(value, x, y);
}

/** Numbering template: 68x70 green rounded square, 52x54 white face, line letters over the number. */
export function numbering(
  ctx: CanvasRenderingContext2D,
  code: string,
  x: number,
  y: number,
  scale = 1,
) {
  const parts = code.match(/^([A-Z]+)(\d+)$/);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = LINE;
  ctx.beginPath();
  ctx.roundRect(0, 0, 68, 70, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(8, 8, 52, 54, 2);
  ctx.fill();
  text(ctx, parts?.[1] ?? code, 34, 30, 20, SANS, ACTIVE, { weight: 600, align: 'center' });
  if (parts) text(ctx, parts[2], 34, 58, 28, SANS, ACTIVE, { weight: 600, align: 'center' });
  ctx.restore();
}

/** Path2D from SVG data; absent outside the browser (unit tests draw on a stub context). */
export const svg = (d: string) => (typeof Path2D === 'undefined' ? null : new Path2D(d));

export function path(ctx: CanvasRenderingContext2D, d: string, x: number, y: number, fill: string) {
  const shape = svg(d);
  if (!shape) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.fill(shape);
  ctx.restore();
}
