import { cueIndex, resolveAssetUrl } from './asset-loader';
import type {
  CueRole,
  DoorSequenceApi,
  DoorSequencePlan,
  LoadedSubwayLine,
  PackCueRecord,
  ResolvedCue,
  RuntimeCueManifest,
  SegmentCuePlan,
  TimedCue,
} from './sound-types';

const warnedVariantFallbacks = new Set<string>();
const doorRoles: Readonly<Record<string, CueRole>> = {
  chime_open: 'chime',
  chime_close: 'chime',
  signal: 'signal',
  open: 'mechanics',
  close: 'mechanics',
  platform_open: 'signal',
  platform_close: 'signal',
  bell: 'bell',
  departure_melody: 'melody',
};
/** The closing door mechanics sit under the opening ones, which share their file. */
const doorTrimDb: Readonly<Record<string, number>> = { close: -4 };

export function resolveCue(
  record: PackCueRecord,
  role: CueRole,
  manifest: RuntimeCueManifest,
  base: string,
  stationCode?: string,
): ResolvedCue {
  const variants = Array.isArray(record.variants)
    ? (record.variants as { stations?: unknown; file?: unknown }[])
    : [];
  const variant = stationCode
    ? variants.find(
        (item) =>
          Array.isArray(item.stations) &&
          item.stations.includes(stationCode) &&
          typeof item.file === 'string',
      )
    : undefined;
  let file = (variant?.file as string | undefined) ?? record.file;
  let entry = cueIndex(manifest).get(file);
  let gain = entry?.gainByRole[role];
  if (variant && (!entry || gain === undefined)) {
    if (!warnedVariantFallbacks.has(file)) {
      warnedVariantFallbacks.add(file);
      console.warn(`Subway station cue unavailable; using line default: ${file} → ${record.file}`);
    }
    file = record.file;
    entry = cueIndex(manifest).get(file);
    gain = entry?.gainByRole[role];
  }
  if (!entry || gain === undefined) {
    throw new Error(`Missing ${role} catalogue entry: ${file}`);
  }
  return { ...entry, gain, role, url: resolveAssetUrl(file, base) };
}

export function selectDirectionalEntries(
  entries: readonly PackCueRecord[] | undefined,
  direction: string,
): PackCueRecord[] {
  if (!entries?.length) {
    return [];
  }
  const exact = entries.filter((entry) => entry.direction === direction);
  const compatible = entries.filter(
    (entry) => !entry.direction && entry.directions?.includes(direction),
  );
  const neutral = entries.filter((entry) => !entry.direction && !entry.directions?.length);
  const selected = exact.length ? exact : compatible.length ? compatible : neutral;
  const seen = new Set<string>();
  return selected.filter((entry) => {
    if (seen.has(entry.file)) {
      return false;
    }
    seen.add(entry.file);
    return true;
  });
}

export function selectStationEntries(
  entries: readonly PackCueRecord[] | undefined,
  stationCode: string,
  kind: string,
  direction: string,
): PackCueRecord[] {
  return selectDirectionalEntries(
    entries?.filter((entry) => entry.station === stationCode && entry.kind === kind),
    direction,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function packStations(line: LoadedSubwayLine): Record<string, unknown>[] {
  const stations = line.pack.stations;
  const values = Array.isArray(stations)
    ? stations
    : stations && typeof stations === 'object'
      ? Object.values(stations as Record<string, unknown>)
      : [];
  return values.map(asRecord).filter((item): item is Record<string, unknown> => !!item);
}

function packStation(line: LoadedSubwayLine, code: string): Record<string, unknown> | undefined {
  return packStations(line).find((station) => station.code === code);
}

function cueEntries(value: unknown, language: string): PackCueRecord[] {
  const localized = asRecord(value)?.[language];
  return Array.isArray(localized)
    ? localized.filter(
        (entry): entry is PackCueRecord =>
          !!asRecord(entry) && typeof (entry as PackCueRecord).file === 'string',
      )
    : [];
}

function queueStationCues(
  station: Record<string, unknown>,
  group: 'next' | 'arriving' | 'transfer',
  stationCode: string,
  direction: string,
  languages: readonly string[],
  catalogue: RuntimeCueManifest,
  base: string,
): TimedCue[] {
  const result: TimedCue[] = [];
  let at = 0;
  for (const language of languages) {
    const selected = selectStationEntries(
      cueEntries(station[group], language),
      stationCode,
      group,
      direction,
    )[0];
    if (!selected) {
      continue;
    }
    const cue = resolveCue(selected, 'voice', catalogue, base);
    result.push({ part: `${group}:${language}`, at, cue });
    at += cue.duration + 0.3;
  }
  return result;
}

function packDepartureMelody(line: LoadedSubwayLine): PackCueRecord | undefined {
  const entries = Array.isArray(line.pack.on_station) ? line.pack.on_station : [];
  return entries
    .map(asRecord)
    .find(
      (entry): entry is Record<string, unknown> & PackCueRecord =>
        !!entry &&
        (entry.kind === 'departure_melody' ||
          (typeof entry.text === 'string' &&
            entry.text.trim().toLowerCase() === 'departure melody')),
    );
}

function departureMelody(
  line: LoadedSubwayLine,
  station: Record<string, unknown>,
  stationCode: string,
  direction: string,
  catalogue: RuntimeCueManifest,
  base: string,
): ResolvedCue | undefined {
  const byDirection = asRecord(station.departure_melody);
  const stationMelody = asRecord(byDirection?.[direction]) as PackCueRecord | undefined;
  const melody =
    stationMelody && typeof stationMelody.file === 'string'
      ? stationMelody
      : packDepartureMelody(line);
  return melody && typeof melody.file === 'string'
    ? resolveCue(melody, 'melody', catalogue, base, stationCode)
    : undefined;
}

function planContainsDepartureMelody(sequence: unknown): boolean {
  const close = asRecord(sequence)?.close;
  return Array.isArray(close) && close.some((step) => asRecord(step)?.part === 'departure_melody');
}

function withoutDepartureMelodyAnchor(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const match = /^departure_melody_end([+-]\d+(?:\.\d+)?)?$/.exec(value);
  return match ? Number(match[1] ?? 0) : value;
}

function resolveDoorPlanLine(
  line: LoadedSubwayLine,
  catalogue: RuntimeCueManifest,
  base: string,
  stationCode?: string,
  melody?: ResolvedCue,
): { sequence: unknown; cues: Record<string, ResolvedCue> } {
  const doors = line.pack.doors as { sequence?: unknown; [key: string]: unknown } | undefined;
  if (!doors?.sequence) {
    throw new Error(`Door sequence missing for ${String(line.pack.id)}`);
  }
  const sequenceRecord = asRecord(doors.sequence);
  const closeSteps = sequenceRecord?.close;
  const filteredSequence =
    Array.isArray(closeSteps) && !melody
      ? {
          ...sequenceRecord,
          close: closeSteps
            .filter((step) => asRecord(step)?.part !== 'departure_melody')
            .map((step) => {
              const record = asRecord(step);
              if (!record) {
                return step;
              }
              return {
                ...record,
                ...(Object.hasOwn(record, 'at')
                  ? { at: withoutDepartureMelodyAnchor(record.at) }
                  : {}),
                ...(Object.hasOwn(record, 'until')
                  ? { until: withoutDepartureMelodyAnchor(record.until) }
                  : {}),
              };
            }),
        }
      : doors.sequence;
  const cues: Record<string, ResolvedCue> = {};
  if (melody) {
    cues.departure_melody = melody;
  }
  for (const [part, value] of Object.entries(doors)) {
    if (
      part === 'sequence' ||
      !asRecord(value) ||
      typeof (value as PackCueRecord).file !== 'string'
    ) {
      continue;
    }
    const role = doorRoles[part];
    if (!role) {
      throw new Error(`Unknown Subway door cue role: ${part}`);
    }
    const cue = resolveCue(value as PackCueRecord, role, catalogue, base, stationCode);
    cues[part] = doorTrimDb[part] === undefined ? cue : { ...cue, trimDb: doorTrimDb[part] };
  }
  return { sequence: filteredSequence, cues };
}

function freezePlan(plan: DoorSequencePlan): DoorSequencePlan {
  const events = plan.events.map((event) =>
    Object.freeze({
      ...event,
      cue: Object.freeze({
        ...event.cue,
        audible_end: Math.min(event.cue.audible_end, event.cue.duration),
      }),
    }),
  );
  return Object.freeze({
    ...plan,
    events: Object.freeze(events) as unknown as DoorSequencePlan['events'],
  });
}

export function buildSegmentCuePlan(
  line: LoadedSubwayLine,
  from: string,
  to: string,
  direction: string,
  languages: readonly string[],
  hasTransfers: boolean,
  catalogue: RuntimeCueManifest,
  base: string,
  planner: DoorSequenceApi,
): SegmentCuePlan {
  const source = packStation(line, from);
  const target = packStation(line, to);
  if (!source || !target) {
    throw new Error(`Missing Subway pack station for ${from} → ${to}`);
  }
  const languageOrder = [...new Set(languages)].filter((language) =>
    ['ja', 'en', 'zh', 'ko'].includes(language),
  );
  const melody = departureMelody(line, source, from, direction, catalogue, base);
  const doors = asRecord(line.pack.doors);
  const sequence = doors?.sequence;
  const includesMelody = planContainsDepartureMelody(sequence);
  const closeInput = resolveDoorPlanLine(
    line,
    catalogue,
    base,
    from,
    includesMelody ? melody : undefined,
  );
  const openInput = resolveDoorPlanLine(line, catalogue, base, to);
  const close = freezePlan(planner.plan(closeInput, 'close'));
  const open = freezePlan(planner.plan(openInput, 'open'));
  const departure = queueStationCues(target, 'next', to, direction, languageOrder, catalogue, base);
  const arrival = [
    ...queueStationCues(target, 'arriving', to, direction, languageOrder, catalogue, base),
    ...(hasTransfers
      ? queueStationCues(target, 'transfer', to, direction, languageOrder, catalogue, base)
      : []),
  ];
  const emergency: TimedCue[] = [];
  const emergencyRecords = (Array.isArray(line.pack.emergency) ? line.pack.emergency : []).filter(
    (entry): entry is PackCueRecord =>
      !!asRecord(entry) &&
      (entry as PackCueRecord).kind === 'emergency' &&
      (entry as PackCueRecord).scenario === 'emergency stop',
  );
  let at = 0;
  for (const language of languageOrder) {
    const selected = selectDirectionalEntries(
      emergencyRecords.filter((entry) => entry.lang === language),
      direction,
    )[0];
    if (!selected) {
      continue;
    }
    const cue = resolveCue(selected, 'voice', catalogue, base);
    emergency.push({ part: `emergency:${language}`, at, cue });
    at += cue.duration + 0.3;
  }
  const preClose =
    melody && !includesMelody ? [{ part: 'departure_melody', at: 0, cue: melody }] : [];
  return Object.freeze({
    close,
    open,
    ...(preClose.length
      ? { preClose: Object.freeze(preClose.map((item) => Object.freeze(item))) }
      : {}),
    departure: Object.freeze(departure.map((item) => Object.freeze(item))),
    arrival: Object.freeze(arrival.map((item) => Object.freeze(item))),
    emergency: Object.freeze(emergency.map((item) => Object.freeze(item))),
  });
}
