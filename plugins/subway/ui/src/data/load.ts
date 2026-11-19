import catalogue from './catalogue.json';
import { findIcon } from '../icons/catalogue';
import type { CatalogueDirection, LineFacts } from './contracts';
import { DISPLAY_PRESETS, presetOf } from './presets';

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

function codeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((code) => typeof code === 'string');
}

function direction(id: string, value: unknown, stations: readonly string[]): CatalogueDirection {
  if (!isRecord(value) || !text(value.id) || !text(value.title)) {
    fail(id, 'invalid direction');
  }
  if (value.delta !== 1 && value.delta !== -1) {
    fail(id, `direction ${value.id} delta`);
  }
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
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !codeList(value.upper) || !codeList(value.lower)) {
    fail(id, 'invalid loopMap');
  }
  const placed = [...value.upper, ...value.lower];
  if (
    placed.length !== stations.length ||
    new Set(placed).size !== stations.length ||
    placed.some((code) => !stations.includes(code))
  ) {
    fail(id, 'loopMap must place every station exactly once');
  }
  return Object.freeze({
    upper: Object.freeze([...value.upper]),
    lower: Object.freeze([...value.lower]),
  });
}

function lineFacts(id: string, value: unknown): LineFacts {
  if (!isRecord(value) || value.id !== id) {
    fail(id, 'file does not match its id');
  }
  const { title, code, iconId, carCount, loop, stations, displayLanguages, directions } = value;
  if (!text(title) || !text(code)) {
    fail(id, 'title and code are required');
  }
  if (typeof iconId !== 'string' || !findIcon(iconId)) {
    fail(id, 'iconId is not in the icon catalogue');
  }
  if (
    !codeList(stations) ||
    !stations.length ||
    new Set(stations).size !== stations.length ||
    stations.some((station) => !CODE_PATTERN.test(station) || !station.startsWith(code))
  ) {
    fail(id, 'stations must be unique codes with the line prefix');
  }
  if (typeof carCount !== 'number' || !Number.isInteger(carCount) || carCount < 1) {
    fail(id, 'carCount must be a positive integer');
  }
  if (typeof loop !== 'boolean') {
    fail(id, 'loop must be boolean');
  }
  if (
    !codeList(displayLanguages) ||
    !displayLanguages.length ||
    displayLanguages.some((preset) => !presetOf(DISPLAY_PRESETS, preset))
  ) {
    fail(id, 'displayLanguages must list known display presets');
  }
  if (!Array.isArray(directions) || !directions.length) {
    fail(id, 'directions are required');
  }
  return Object.freeze({
    id,
    title,
    code,
    iconId,
    carCount,
    loop,
    loopMap: loopMap(id, value.loopMap, stations),
    displayLanguages: Object.freeze([...displayLanguages]),
    directions: Object.freeze(directions.map((item) => direction(id, item, stations))),
    stations: Object.freeze([...stations]),
  });
}

export const LINE_CATALOGUE: readonly LineFacts[] = Object.freeze(
  catalogue.lines.map((id) => {
    const file = files[`./lines/${id}.json`];
    if (!file) {
      fail(id, 'missing line file');
    }
    return lineFacts(id, file);
  }),
);

export const PAUSED_LINES: ReadonlySet<string> = new Set(['hibiya', 'sakaisuji']);

export function lineFactsFor(id: unknown): LineFacts | undefined {
  return LINE_CATALOGUE.find((line) => line.id === id);
}
