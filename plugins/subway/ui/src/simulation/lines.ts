import { LINE_CATALOGUE, lineFactsFor } from '../data/load';
import type { LineFacts } from '../data/contracts';
import type { buildDirectionDetails } from './station-details';
import { nonEmpty, record, requiredNames, type RawRecord } from './line-raw';
import { normalizeStation } from './line-stations';

export type LocalizedNames = Readonly<Record<string, string>>;

export interface LineDirection {
  id: string;
  delta: 1 | -1;
  names: LocalizedNames;
}

export type StationTransfer =
  | { kind: 'badge'; code: string; source: string; revision?: string }
  | { kind: 'text'; names: LocalizedNames; source: string; revision?: string };

export interface StationDefinition {
  id: string;
  code: string;
  order: number;
  abbr?: string;
  names: LocalizedNames;
  coordinates?: Readonly<{ lat: number; lon: number }>;
  transfers: readonly StationTransfer[];
  doorByDirection: Readonly<
    Record<string, ReturnType<typeof buildDirectionDetails>['doorByDirection'][string]>
  >;
  platformByDirection: Readonly<
    Record<string, ReturnType<typeof buildDirectionDetails>['platformByDirection'][string]>
  >;
}

export interface LineDefinition {
  id: string;
  code: string;
  order: number;
  names: LocalizedNames;
  color: string;
  loop: boolean;
  carCount: number;
  directions: readonly LineDirection[];
  stations: readonly StationDefinition[];
}

export interface RawLineBundle {
  line: unknown;
  pack: unknown;
}

const COLOR_PATTERN = /^#[\da-f]{6}$/i;

function directionNames(
  facts: LineFacts,
  directionId: string,
  rawLineDirections: RawRecord | undefined,
  rawPackDirections: RawRecord | undefined,
  stations: readonly StationDefinition[],
): LocalizedNames {
  const lineLabel = rawLineDirections?.[directionId];
  const packLabel = rawPackDirections?.[directionId];
  const direction = facts.directions.find((item) => item.id === directionId);
  if (facts.loop) {
    const label = nonEmpty(lineLabel ?? packLabel, `Direction ${directionId} label`);
    return Object.freeze({ ja: label, en: direction?.title ?? directionId });
  }
  const endpointJa = stations.find((station) => station.code === direction?.target)?.names.ja;
  return Object.freeze({
    en: nonEmpty(packLabel ?? lineLabel, `Direction ${directionId} label`),
    ja: `${endpointJa}方面`,
  });
}

export function normalizeSubwayLine(rawLine: unknown, rawPack: unknown): LineDefinition {
  const line = record(rawLine, 'Line definition');
  const pack = record(rawPack, 'Line sound pack');
  const id = nonEmpty(line.id, 'Line id');
  const facts = lineFactsFor(id);
  if (!facts) {
    throw new Error(`Unknown Subway line: ${id}`);
  }
  const lineId = facts.id;
  if (pack.id !== lineId) {
    throw new Error(`Line and sound pack ids differ: ${lineId} / ${String(pack.id)}`);
  }

  const name = requiredNames(line.name, `Line ${lineId} name`);
  const color = nonEmpty(line.color, `Line ${lineId} color`);
  if (!COLOR_PATTERN.test(color)) {
    throw new Error(`Invalid line color: ${color}`);
  }
  if (typeof line.loop !== 'boolean') {
    throw new Error(`Line ${lineId} loop flag must be boolean`);
  }
  if (line.loop !== facts.loop) {
    throw new Error(`Unexpected loop flag for ${lineId}`);
  }

  const rawStations = line.stations;
  const packStations = pack.stations;
  if (!Array.isArray(rawStations) || !rawStations.length) {
    throw new Error(`Line ${lineId} stations must be a non-empty array`);
  }
  if (!Array.isArray(packStations) || packStations.length !== rawStations.length) {
    throw new Error(`Line ${lineId} and pack station counts differ`);
  }
  const expectedCode = facts.code;
  const seenCodes = new Set<string>();

  const rawTransfers =
    line.transfers === undefined ? undefined : record(line.transfers, `Line ${lineId} transfers`);
  const rawLineDirections =
    line.directions === undefined
      ? undefined
      : record(line.directions, `Line ${lineId} directions`);
  const rawPackDirections =
    pack.directions === undefined
      ? undefined
      : record(pack.directions, `Pack ${lineId} directions`);
  const directionSpecs = facts.directions;
  const directionIds = directionSpecs.map((direction) => direction.id);
  for (const labels of [rawLineDirections, rawPackDirections]) {
    if (!labels) {
      continue;
    }
    const keys = Object.keys(labels);
    if (
      keys.length !== directionIds.length ||
      directionIds.some((direction) => !Object.hasOwn(labels, direction))
    ) {
      throw new Error(`Invalid direction keys for ${lineId}`);
    }
  }
  if (!rawLineDirections && !rawPackDirections) {
    throw new Error(`Line ${lineId} has no direction labels`);
  }

  const stationRecords = rawStations.map((item, order) =>
    normalizeStation(item, packStations[order], order, { facts, seenCodes, rawTransfers }),
  );

  if (rawTransfers) {
    for (const code of Object.keys(rawTransfers)) {
      if (!seenCodes.has(code)) {
        throw new Error(`Transfer prose references unknown station: ${code}`);
      }
    }
  }

  const directions = Object.freeze(
    directionSpecs.map((spec) =>
      Object.freeze({
        id: spec.id,
        delta: spec.delta,
        names: directionNames(facts, spec.id, rawLineDirections, rawPackDirections, stationRecords),
      }),
    ),
  );
  return Object.freeze({
    id: lineId,
    code: expectedCode,
    order: LINE_CATALOGUE.indexOf(facts),
    names: name,
    color,
    loop: line.loop,
    carCount: facts.carCount,
    directions,
    stations: Object.freeze(stationRecords),
  });
}

function lineOf(byId: ReadonlyMap<string, LineDefinition>, id: string): LineDefinition {
  const line = byId.get(id);
  if (!line) {
    throw new Error(`Subway line catalog is missing ${id}`);
  }
  return line;
}

export function normalizeSubwayLines(
  bundles: readonly RawLineBundle[] | Readonly<Record<string, RawLineBundle>>,
): readonly LineDefinition[] {
  const entries = Array.isArray(bundles) ? bundles : Object.values(bundles);
  const byId = new Map<string, LineDefinition>();
  for (const bundle of entries) {
    const definition = normalizeSubwayLine(bundle.line, bundle.pack);
    if (byId.has(definition.id)) {
      throw new Error(`Duplicate Subway line: ${definition.id}`);
    }
    byId.set(definition.id, definition);
  }
  const ids = LINE_CATALOGUE.map((facts) => facts.id);
  if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw new Error(`Subway line catalog must contain ${ids.join(', ')}`);
  }
  return Object.freeze(ids.map((id) => lineOf(byId, id)));
}

export function localizedName(names: LocalizedNames, language: string, fallback = ''): string {
  return names[language.toLowerCase()] || names.en || names.ja || fallback;
}

export function stepStation(
  line: LineDefinition,
  stationCode: string,
  directionId: string,
): StationDefinition | undefined {
  const currentIndex = line.stations.findIndex((station) => station.code === stationCode);
  const direction = line.directions.find((item) => item.id === directionId);
  if (currentIndex < 0 || !direction) {
    return undefined;
  }
  const targetIndex = currentIndex + direction.delta;
  if (line.loop) {
    return line.stations[
      ((targetIndex % line.stations.length) + line.stations.length) % line.stations.length
    ];
  }
  return line.stations[targetIndex];
}
