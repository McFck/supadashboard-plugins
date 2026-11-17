import catalogue from './catalogue.json';
import { findIcon } from '../icons/catalogue';
import type { CatalogueDirection, LineFacts } from './contracts';

const CODE_PATTERN = /^[A-Z]{1,3}\d{2}$/;
const files = import.meta.glob<unknown>('./lines/*.json', { eager: true, import: 'default' });

function fail(id: string, message: string): never {
  throw new Error(`Subway catalogue ${id}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function direction(id: string, value: unknown, stations: readonly string[]): CatalogueDirection {
  if (!isRecord(value) || !text(value.id) || !text(value.title)) fail(id, 'invalid direction');
  if (value.delta !== 1 && value.delta !== -1) fail(id, `direction ${value.id} delta`);
  const target = value.target;
  if (target !== undefined && (typeof target !== 'string' || !stations.includes(target))) {
    fail(id, `direction ${value.id} target is not a station`);
  }
  return Object.freeze({
    id: value.id,
    delta: value.delta,
    title: value.title,
    ...(target ? { target } : {}),
  });
}

function loopMap(id: string, value: unknown, stations: readonly string[]): LineFacts['loopMap'] {
  if (value === undefined) return undefined;
  const rows = isRecord(value) ? [value.upper, value.lower] : [];
  if (rows.length !== 2 || rows.some((row) => !Array.isArray(row))) fail(id, 'invalid loopMap');
  const placed = (rows as string[][]).flat();
  if (new Set(placed).size !== stations.length || placed.some((code) => !stations.includes(code))) {
    fail(id, 'loopMap must place every station exactly once');
  }
  return Object.freeze({
    upper: Object.freeze([...(rows[0] as string[])]),
    lower: Object.freeze([...(rows[1] as string[])]),
  });
}

function lineFacts(id: string, value: unknown): LineFacts {
  if (!isRecord(value) || value.id !== id) fail(id, 'file does not match its id');
  if (!text(value.title) || !text(value.code)) fail(id, 'title and code are required');
  if (typeof value.iconId !== 'string' || !findIcon(value.iconId))
    fail(id, 'iconId is not in the icon catalogue');
  const stations = value.stations;
  if (
    !Array.isArray(stations) ||
    !stations.length ||
    new Set(stations).size !== stations.length ||
    stations.some(
      (code) =>
        typeof code !== 'string' || !CODE_PATTERN.test(code) || !code.startsWith(`${value.code}`),
    )
  ) {
    fail(id, 'stations must be unique codes with the line prefix');
  }
  const codes = stations as string[];
  if (!Number.isInteger(value.carCount) || (value.carCount as number) < 1)
    fail(id, 'carCount must be a positive integer');
  if (typeof value.loop !== 'boolean') fail(id, 'loop must be boolean');
  const languages = value.displayLanguages;
  if (!Array.isArray(languages) || !languages.length || languages.some((item) => !text(item))) {
    fail(id, 'displayLanguages must list at least one preset');
  }
  const directions = value.directions;
  if (!Array.isArray(directions) || !directions.length) fail(id, 'directions are required');
  return Object.freeze({
    id,
    title: value.title,
    code: value.code,
    iconId: value.iconId,
    carCount: value.carCount as number,
    loop: value.loop,
    loopMap: loopMap(id, value.loopMap, codes),
    displayLanguages: Object.freeze([...(languages as string[])]),
    directions: Object.freeze(directions.map((item) => direction(id, item, codes))),
    stations: Object.freeze([...codes]),
  });
}

/** Catalogue lines in display order. Throws at import when the data is inconsistent. */
export const LINE_CATALOGUE: readonly LineFacts[] = Object.freeze(
  catalogue.lines.map((id) => {
    const file = files[`./lines/${id}.json`];
    if (!file) fail(id, 'missing line file');
    return lineFacts(id, file);
  }),
);

/**
 * Lines kept loadable but hidden from every picker and from "next line" until their displays are redrawn
 * (owner decision; research in app/docs/subway-lcd-plan.md).
 */
export const PAUSED_LINES: ReadonlySet<string> = new Set(['hibiya', 'sakaisuji']);

export function lineFactsFor(id: unknown): LineFacts | undefined {
  return LINE_CATALOGUE.find((line) => line.id === id);
}
