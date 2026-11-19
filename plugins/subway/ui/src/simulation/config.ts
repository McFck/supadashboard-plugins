import { LINE_CATALOGUE, lineFactsFor } from '../data/load';
import { ANNOUNCEMENT_PRESETS, DISPLAY_PRESETS, presetOf } from '../data/presets';
import type { LineDefinition } from './lines';

const [firstLine] = LINE_CATALOGUE;
export const SUBWAY_DEFAULT_CONFIG = Object.freeze({
  line: firstLine.id,
  direction: firstLine.directions[0].id,
  startStation: firstLine.stations[0],
  displayLanguages: 'ja-en',
  announcementLanguages: 'ja-en',
  immersion: false,
  announcementVolume: 0.8,
});

export type NormalizedSubwayConfig = Readonly<
  Record<string, unknown> & {
    line: string;
    direction: string;
    startStation: string;
    speed: 0.5 | 1 | 2;
    /** The car the passenger rides in; `null` picks one at random for each run. */
    carNumber: number | null;
    displayLanguages: string;
    announcementLanguages: string;
    immersion: boolean;
    announcementVolume: number;
  }
>;

/** A car of the line's formation chosen in the settings (a number or its select string), else `null`. */
export function carNumber(value: unknown, carCount: number): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof number === 'number' && Number.isInteger(number) && number >= 1 && number <= carCount) {
    return number;
  }
  return null;
}

export function displayLanguages(preset: unknown): readonly string[] {
  return presetOf(DISPLAY_PRESETS, preset)?.languages ?? [];
}

export function announcementLanguages(preset: unknown): readonly string[] {
  return presetOf(ANNOUNCEMENT_PRESETS, preset)?.languages ?? [];
}

function supportedDisplay(line: LineDefinition, preset: string): boolean {
  if (!lineFactsFor(line.id)?.displayLanguages.includes(preset)) {
    return false;
  }
  const languages = displayLanguages(preset);
  return (
    languages.length > 0 &&
    languages.every((language) => line.stations.some((station) => station.names[language]))
  );
}

export function firstStationForDirection(line: LineDefinition, directionId: string): string {
  const direction = line.directions.find((item) => item.id === directionId) ?? line.directions[0];
  return direction.delta === -1
    ? line.stations[line.stations.length - 1].code
    : line.stations[0].code;
}

/** Validate dependent settings at the runtime boundary while retaining unrelated saved keys. */
export function normalizeSubwayConfig(
  stored: Readonly<Record<string, unknown>>,
  lines: readonly LineDefinition[],
): NormalizedSubwayConfig {
  const fallbackLine = lines.find((line) => line.id === SUBWAY_DEFAULT_CONFIG.line) ?? lines[0];
  if (!fallbackLine) {
    throw new Error('Subway has no normalized line data');
  }
  const line = lines.find((item) => item.id === stored.line) ?? fallbackLine;
  const requestedDirection = stored.direction;
  const direction =
    typeof requestedDirection === 'string' &&
    line.directions.some((item) => item.id === requestedDirection)
      ? requestedDirection
      : line.directions[0].id;
  // Older settings saved the start station as `station`.
  const requestedStation =
    typeof stored.startStation === 'string' ? stored.startStation : stored.station;
  const startStation =
    typeof requestedStation === 'string' &&
    line.stations.some((item) => item.code === requestedStation)
      ? requestedStation
      : firstStationForDirection(line, direction);
  const requestedSpeed =
    typeof stored.speed === 'string' && stored.speed.trim() ? Number(stored.speed) : stored.speed;
  const speed: 0.5 | 1 | 2 = requestedSpeed === 0.5 || requestedSpeed === 2 ? requestedSpeed : 1;
  const defaultDisplay = lineFactsFor(line.id)?.displayLanguages[0] ?? 'ja-en';
  const requestedDisplay = stored.displayLanguages;
  const display =
    typeof requestedDisplay === 'string' && supportedDisplay(line, requestedDisplay)
      ? requestedDisplay
      : defaultDisplay;
  const announcements =
    typeof stored.announcementLanguages === 'string' &&
    presetOf(ANNOUNCEMENT_PRESETS, stored.announcementLanguages)
      ? stored.announcementLanguages
      : 'ja-en';
  const volume =
    typeof stored.announcementVolume === 'number' && Number.isFinite(stored.announcementVolume)
      ? Math.min(1, Math.max(0, stored.announcementVolume))
      : 0.8;
  return Object.freeze({
    ...stored,
    line: line.id,
    direction,
    startStation,
    speed,
    carNumber: carNumber(stored.carNumber, line.carCount),
    displayLanguages: display,
    announcementLanguages: announcements,
    immersion: typeof stored.immersion === 'boolean' ? stored.immersion : false,
    announcementVolume: volume,
  });
}
