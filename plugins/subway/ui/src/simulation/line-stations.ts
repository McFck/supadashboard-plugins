import type { LineFacts } from '../data/contracts';
import {
  CODE_PATTERN,
  localizedNames,
  nonEmpty,
  record,
  requiredNames,
  type RawRecord,
} from './line-raw';
import type { StationDefinition, StationTransfer } from './lines';
import { buildDirectionDetails, transferSupplements, type SideEvidence } from './station-details';

function isDirection(value: unknown): value is 'left' | 'right' | 'both' {
  return value === 'left' || value === 'right' || value === 'both';
}

function sideEvidenceFor(value: unknown, validDirections: ReadonlySet<string>): SideEvidence[] {
  const evidence: SideEvidence[] = [];
  const seen = new Set<string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') {
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const source = record(item, 'Pack entry');
    // `directions` means a clip may be reused there; only its explicit `direction`
    // ties the side evidence to one platform direction.
    if (
      typeof source.direction === 'string' &&
      validDirections.has(source.direction) &&
      isDirection(source.side)
    ) {
      const sourceName =
        typeof source.source === 'string' && source.source.trim()
          ? source.source.trim()
          : 'pack.json';
      const key = `${source.direction}\0${source.side}\0${sourceName}`;
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push({
          direction: source.direction,
          side: source.side,
          source: `pack.json:${sourceName}`,
        });
      }
    }
    Object.values(source).forEach(visit);
  };
  visit(value);
  return evidence;
}

function stationTransfers(
  lineId: string,
  code: string,
  rawStation: RawRecord,
  rawTransfers: RawRecord | undefined,
): readonly StationTransfer[] {
  const result: StationTransfer[] = [];
  const seenCodes = new Set<string>();
  const addCode = (value: unknown, source: string, revision?: string): void => {
    const transferCode = nonEmpty(value, `Transfer code at ${code}`);
    if (!CODE_PATTERN.test(transferCode)) {
      throw new Error(`Invalid transfer code at ${code}: ${transferCode}`);
    }
    if (seenCodes.has(transferCode)) {
      return;
    }
    seenCodes.add(transferCode);
    result.push(
      Object.freeze({
        kind: 'badge',
        code: transferCode,
        source,
        ...(revision ? { revision } : {}),
      }),
    );
  };
  const addText = (value: unknown, source: string, revision?: string): void => {
    const names = localizedNames(value, `Transfer text at ${code}`);
    if (!Object.keys(names).length) {
      return;
    }
    result.push(Object.freeze({ kind: 'text', names, source, ...(revision ? { revision } : {}) }));
  };

  const transferCodes = rawStation.transferCodes ?? [];
  if (!Array.isArray(transferCodes)) {
    throw new Error(`Transfer codes at ${code} must be an array`);
  }
  for (const transferCode of transferCodes) {
    addCode(transferCode, 'line.json');
  }
  const supplement = transferSupplements[lineId]?.[code];
  if (supplement?.codes) {
    for (const transferCode of supplement.codes) {
      addCode(transferCode, supplement.source, supplement.revision);
    }
  }
  // Operator text (such as JR lines) follows the subway lines.
  const rawText = rawTransfers?.[code];
  if (rawText !== undefined) {
    addText(rawText, 'line.json');
  }
  if (supplement?.text) {
    addText(supplement.text, supplement.source, supplement.revision);
  }
  return Object.freeze(result);
}

function stationCoordinates(
  code: string,
  rawStation: RawRecord,
): Readonly<{ lat: number; lon: number }> | undefined {
  const { lat, lon } = rawStation;
  if ((lat === undefined) !== (lon === undefined)) {
    throw new Error(`Station ${code} has incomplete coordinates`);
  }
  if (lat === undefined) {
    return undefined;
  }
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lon !== 'number' ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error(`Station ${code} has invalid coordinates`);
  }
  return Object.freeze({ lat, lon });
}

/** One station of a line file with its sound-pack record, checked against the catalogue's station order. */
export function normalizeStation(
  rawItem: unknown,
  rawPackItem: unknown,
  order: number,
  line: {
    facts: LineFacts;
    /** Codes of the stations before this one; this station's code is added. */
    seenCodes: Set<string>;
    rawTransfers: RawRecord | undefined;
  },
): StationDefinition {
  const { facts, seenCodes, rawTransfers } = line;
  const rawStation = record(rawItem, `Line ${facts.id} station ${order + 1}`);
  const code = nonEmpty(rawStation.code, `Line ${facts.id} station code`);
  if (!CODE_PATTERN.test(code) || !code.startsWith(facts.code)) {
    throw new Error(`Invalid station code for ${facts.id}: ${code}`);
  }
  if (seenCodes.has(code)) {
    throw new Error(`Duplicate station code: ${code}`);
  }
  if (facts.stations[order] !== code) {
    throw new Error(
      `Station ${order + 1} of ${facts.id} is ${code}, the catalogue lists ${facts.stations[order]}`,
    );
  }
  seenCodes.add(code);

  const rawPackStation = record(rawPackItem, `Pack ${facts.id} station ${order + 1}`);
  if (rawPackStation.code !== code) {
    throw new Error(`Pack station order mismatch at ${facts.id} ${code}`);
  }
  const names = requiredNames(
    {
      ja: rawStation.kanji ?? rawStation.name,
      en: rawStation.romaji ?? rawStation.name,
      kana: rawStation.kana,
      zh: rawStation.zh,
      ko: rawStation.ko,
    },
    `Station ${code} name`,
  );
  const coordinates = stationCoordinates(code, rawStation);
  const directionIds = facts.directions.map((direction) => direction.id);
  const details = buildDirectionDetails(
    directionIds,
    facts.carCount,
    sideEvidenceFor(rawPackStation, new Set(directionIds)),
  );
  return Object.freeze({
    id: code,
    code,
    order,
    ...(typeof rawStation.abbr === 'string' && rawStation.abbr.trim()
      ? { abbr: rawStation.abbr.trim() }
      : {}),
    names,
    ...(coordinates ? { coordinates } : {}),
    transfers: stationTransfers(facts.id, code, rawStation, rawTransfers),
    doorByDirection: details.doorByDirection,
    platformByDirection: details.platformByDirection,
  });
}
