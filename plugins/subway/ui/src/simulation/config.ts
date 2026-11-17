import { LINE_CATALOGUE, lineFactsFor } from '../data/load';
import type { LineDefinition } from './lines';

export const DISPLAY_LANGUAGE_PRESETS = ['ja-en', 'ja-kana', 'ja-zh', 'ja-ko'] as const;
export const ANNOUNCEMENT_LANGUAGE_PRESETS = ['ja', 'en', 'ja-en'] as const;
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

const displayPresets = new Set<string>(DISPLAY_LANGUAGE_PRESETS);
const announcementPresets = new Set<string>(ANNOUNCEMENT_LANGUAGE_PRESETS);
/** A car chosen in the settings, or `null` when none is (the run then picks one). */
export function explicitCarNumber(value: unknown, carCount: number): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 && number <= carCount
    ? number
    : null;
}

export function normalizeCarNumber(value: unknown, carCount: number): number {
  return explicitCarNumber(value, carCount) ?? 1;
}
const supportedDisplay = (line: LineDefinition, preset: string) => {
  if (!lineFactsFor(line.id)?.displayLanguages.includes(preset)) return false;
  const languages = displayLanguages(preset);
  return (
    languages.length > 0 &&
    languages.every((language) => line.stations.some((station) => station.names[language]))
  );
};

export function displayLanguages(preset: string): string[] {
  if (preset === 'ja-en') return ['ja', 'en'];
  if (preset === 'ja-kana') return ['ja', 'kana'];
  if (preset === 'ja-zh') return ['ja', 'zh'];
  if (preset === 'ja-ko') return ['ja', 'ko'];
  return [];
}

export function announcementLanguages(preset: string): string[] {
  return preset === 'ja'
    ? ['ja']
    : preset === 'en'
      ? ['en']
      : preset === 'ja-en'
        ? ['ja', 'en']
        : [];
}

export function firstStationForDirection(line: LineDefinition, directionId: string): string {
  const direction = line.directions.find((item) => item.id === directionId) ?? line.directions[0];
  return direction.delta === -1 ? line.stations.at(-1)!.code : line.stations[0].code;
}

/** Validate dependent settings at the runtime boundary while retaining unrelated saved keys. */
export function normalizeSubwayConfig(
  stored: Readonly<Record<string, unknown>>,
  lines: readonly LineDefinition[],
): NormalizedSubwayConfig {
  const fallbackLine = lines.find((line) => line.id === SUBWAY_DEFAULT_CONFIG.line) ?? lines[0];
  if (!fallbackLine) throw new Error('Subway has no normalized line data');
  const requestedLine = stored.line;
  const line = lines.find((item) => item.id === requestedLine) ?? fallbackLine;
  const requestedDirection = stored.direction;
  const direction =
    typeof requestedDirection === 'string' &&
    line.directions.some((item) => item.id === requestedDirection)
      ? requestedDirection
      : line.directions[0].id;
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
  const displayCandidate =
    typeof stored.displayLanguages === 'string' && displayPresets.has(stored.displayLanguages)
      ? stored.displayLanguages
      : defaultDisplay;
  const display = supportedDisplay(line, displayCandidate) ? displayCandidate : defaultDisplay;
  const announcementCandidate =
    typeof stored.announcementLanguages === 'string' &&
    announcementPresets.has(stored.announcementLanguages)
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
    carNumber: explicitCarNumber(stored.carNumber, line.carCount),
    displayLanguages: display,
    announcementLanguages: announcementCandidate,
    immersion: typeof stored.immersion === 'boolean' ? stored.immersion : false,
    announcementVolume: volume,
  }) as NormalizedSubwayConfig;
}
