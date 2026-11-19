import { localizedName, type LineDefinition, type StationDefinition } from '../simulation/lines';
import type { RunSnapshot } from '../simulation/run';
import { E235_ICON_DWELL_MS, e235Routine } from '../display/e235/schedule';
import { carNumber } from '../simulation/config';
import { hankyuCycle, hankyuLanguages } from '../display/hankyu-1300/schedule';

export type ScreenPage =
  | 'platform'
  | 'nearby'
  | 'broad'
  | 'transfers'
  | 'closing'
  | 'emergency'
  | 'suspension'
  | 'door'
  | 'notice'
  | 'priority'
  | 'mobile';
export type ScreenLanguage = 'ja' | 'kana' | 'en' | 'zh' | 'ko';

export const isScreenLanguage = (language: string): language is ScreenLanguage =>
  language === 'ja' ||
  language === 'kana' ||
  language === 'en' ||
  language === 'zh' ||
  language === 'ko';

export interface ScreenConfig {
  line: LineDefinition;
  languages?: readonly string[];
  languageOffset?: number;
  manualView?: 'display' | 'map';
  viewingSide?: 'left' | 'right';
  clock?: string;
  currentCar?: number;
}

export interface ScreenSchedule {
  readonly page: ScreenPage;
  readonly language: ScreenLanguage;
  readonly headerLanguage?: ScreenLanguage;
  readonly languages: readonly ScreenLanguage[];
  readonly line: LineDefinition;
  readonly snapshot: Readonly<RunSnapshot>;
  readonly station: StationDefinition;
  readonly nextStation?: StationDefinition;
  readonly guidanceStation: StationDefinition;
  readonly transferStation: StationDefinition;
  readonly clock: string;
  readonly destination: string;
  readonly transfers: readonly string[];
  readonly route: readonly StationDefinition[];
  readonly nearby: readonly StationDefinition[];
  readonly sideLabel: 'this side' | 'opposite side' | 'both sides' | null;
  readonly currentCar: number;
  readonly viewingSide?: 'left' | 'right';
  readonly visibleElapsed: number;
  readonly pageDeadline: number | null;
  readonly languageDeadline: number | null;
  readonly iconPhase: number;
  readonly nextDeadline: number | null;
  readonly invalidationKey: string;
}

const LANGUAGE_DWELL_MS = 6_000;
const INCIDENT_LANGUAGES: readonly ScreenLanguage[] = ['ja', 'en', 'zh', 'ko'];

function supportedLanguages(config: ScreenConfig): ScreenLanguage[] {
  if (config.line.id === 'sakaisuji') {
    return hankyuLanguages(config);
  }
  const requested = config.languages?.filter(isScreenLanguage);
  const choices: ScreenLanguage[] = requested?.length ? requested : ['ja', 'en'];
  const supports = (language: ScreenLanguage) =>
    language === 'zh' || language === 'ko'
      ? config.line.id === 'hibiya'
      : config.line.stations.some((station) => station.names[language]);
  const present = choices.filter(supports);
  const fallback: ScreenLanguage[] = ['ja', 'en'];
  return [
    ...new Set(
      present.length
        ? present
        : fallback.filter((language) =>
            config.line.stations.some((station) => station.names[language]),
          ),
    ),
  ];
}

function cycleFor(
  snapshot: RunSnapshot,
  config: ScreenConfig,
): { pages: { page: ScreenPage; duration: number }[]; period: number } {
  const current =
    config.line.stations.find(
      (station) =>
        station.code ===
        (snapshot.state === 'stopped' || snapshot.state === 'arriving'
          ? snapshot.station
          : snapshot.next),
    ) ?? config.line.stations.find((station) => station.code === snapshot.station);
  const transfers = current?.transfers.length ?? 0;
  if (config.line.id === 'hibiya') {
    const pages =
      snapshot.state === 'stopped'
        ? [
            { page: 'platform' as const, duration: 6_000 },
            { page: 'broad' as const, duration: 6_000 },
          ]
        : [
            { page: 'broad' as const, duration: 8_000 },
            { page: transfers ? ('transfers' as const) : ('nearby' as const), duration: 6_000 },
          ];
    return { pages, period: pages.reduce((sum, page) => sum + page.duration, 0) };
  }
  return hankyuCycle(snapshot, transfers);
}

function routeFrom(
  line: LineDefinition,
  stationCode: string,
  direction: string,
): StationDefinition[] {
  const currentIndex = line.stations.findIndex((station) => station.code === stationCode);
  const routeDirection = line.directions.find((item) => item.id === direction);
  if (currentIndex < 0 || !routeDirection) {
    return [];
  }
  if (!line.loop) {
    return routeDirection.delta > 0
      ? line.stations.slice(currentIndex)
      : line.stations.slice(0, currentIndex + 1).reverse();
  }
  return Array.from(
    { length: line.stations.length },
    (_, index) =>
      line.stations[
        (currentIndex + routeDirection.delta * index + line.stations.length * 2) %
          line.stations.length
      ],
  );
}

function nearbyFrom(
  line: LineDefinition,
  stationCode: string,
  direction: string,
): StationDefinition[] {
  const currentIndex = line.stations.findIndex((station) => station.code === stationCode);
  const routeDirection = line.directions.find((item) => item.id === direction);
  if (currentIndex < 0 || !routeDirection) {
    return [];
  }
  return [-1, 0, 1, 2, 3].flatMap((offset) => {
    const index = currentIndex + routeDirection.delta * offset;
    if (line.loop) {
      return [line.stations[(index + line.stations.length * 2) % line.stations.length]];
    }
    return line.stations[index] ? [line.stations[index]] : [];
  });
}

function sideLabel(
  snapshot: RunSnapshot,
  station: StationDefinition,
  viewingSide: 'left' | 'right',
): ScreenSchedule['sideLabel'] {
  const side = station.doorByDirection[snapshot.direction]?.side ?? 'unknown';
  if (side === 'both') {
    return 'both sides';
  }
  if (side === 'unknown') {
    return null;
  }
  return side === viewingSide ? 'this side' : 'opposite side';
}

function transferNames(station: StationDefinition, language: ScreenLanguage): string[] {
  return station.transfers
    .map((transfer) =>
      transfer.kind === 'badge'
        ? transfer.code
        : localizedName(transfer.names, language, transfer.names.ja ?? transfer.names.en ?? ''),
    )
    .filter(Boolean);
}

export function sessionKey(snapshot: RunSnapshot, config: ScreenConfig): string {
  const phase =
    snapshot.line === 'yamanote' && ['departing', 'cruising'].includes(snapshot.state)
      ? 'running'
      : snapshot.state;
  return [
    snapshot.line,
    snapshot.station,
    snapshot.next,
    snapshot.direction,
    phase,
    snapshot.doors,
    snapshot.generation,
    snapshot.initialStop,
    config.manualView ?? 'display',
    config.viewingSide ?? 'right',
    (config.languages ?? []).join(','),
    config.languageOffset ?? 0,
  ].join('|');
}

function earliest(...deadlines: (number | null)[]): number | null {
  const due = deadlines.filter((value): value is number => value !== null);
  return due.length ? Math.min(...due) : null;
}

export function scheduleScreen(
  snapshot: RunSnapshot,
  config: ScreenConfig,
  visibleElapsed: number,
): ScreenSchedule {
  if (!Number.isFinite(visibleElapsed) || visibleElapsed < 0) {
    throw new Error('Visible screen time must be finite and non-negative');
  }
  const line = config.line;
  if (snapshot.line !== line.id) {
    throw new Error(`Screen line mismatch: ${snapshot.line} / ${line.id}`);
  }
  const station = line.stations.find((item) => item.code === snapshot.station);
  if (!station) {
    throw new Error(`Unknown Subway screen station: ${snapshot.station}`);
  }
  const nextStation = line.stations.find((item) => item.code === snapshot.next);
  const languages = supportedLanguages(config);
  const abnormal = snapshot.state === 'emergency' || snapshot.state === 'suspended';
  const offset = Number.isSafeInteger(config.languageOffset) ? config.languageOffset! : 0;
  const localeIndex =
    (((Math.floor(visibleElapsed / LANGUAGE_DWELL_MS) + offset) % languages.length) +
      languages.length) %
    languages.length;
  let language = languages[localeIndex] ?? 'ja';
  let headerLanguage = language;
  const native =
    line.id === 'yamanote' && !abnormal
      ? e235Routine(snapshot, visibleElapsed, config.viewingSide ?? 'right', languages, offset)
      : null;
  let page: ScreenPage;
  let pageDeadline: number | null = null;
  if (snapshot.state === 'emergency') {
    page = 'emergency';
  } else if (snapshot.state === 'suspended') {
    page = 'suspension';
  } else if (native) {
    page =
      config.manualView === 'map' &&
      !['approaching', 'arriving', 'doorsClosing'].includes(snapshot.state)
        ? 'broad'
        : native.page;
    language = native.language;
    headerLanguage = native.headerLanguage;
    pageDeadline = config.manualView === 'map' ? null : native.pageDeadline;
  } else if (snapshot.state === 'doorsClosing') {
    page = 'closing';
  } else if (snapshot.state === 'approaching' || snapshot.state === 'arriving') {
    page = 'platform';
  } else if (snapshot.state === 'departing') {
    page = 'nearby';
  } else if (config.manualView === 'map') {
    page = 'broad';
  } else {
    const cycle = cycleFor(snapshot, config);
    const position = visibleElapsed % cycle.period;
    let cursor = 0;
    const item =
      cycle.pages.find((entry) => {
        if (position < cursor + entry.duration) {
          return true;
        }
        cursor += entry.duration;
        return false;
      }) ?? cycle.pages[0];
    page = item.page;
    pageDeadline = visibleElapsed + item.duration - (position - cursor);
  }
  const iconsRotate = !!native?.iconsRotate && page === native.page;
  const iconPhase = Math.floor(visibleElapsed / E235_ICON_DWELL_MS);
  const iconDeadline = iconsRotate ? (iconPhase + 1) * E235_ICON_DWELL_MS : null;
  const languageDeadline = abnormal
    ? null
    : (native?.languageDeadline ??
      (Math.floor(visibleElapsed / LANGUAGE_DWELL_MS) + 1) * LANGUAGE_DWELL_MS);
  const direction = line.directions.find((item) => item.id === snapshot.direction);
  const terminal = line.loop
    ? undefined
    : direction?.delta === -1
      ? line.stations[0]
      : line.stations.at(-1);
  const destination = line.loop
    ? localizedName(
        direction?.names ?? {},
        language,
        nextStation ? localizedName(nextStation.names, language, nextStation.code) : '',
      )
    : terminal
      ? localizedName(terminal.names, language, terminal.code)
      : '';
  const route = routeFrom(line, snapshot.station, snapshot.direction);
  const nearby = nearbyFrom(line, snapshot.station, snapshot.direction);
  const transferStation = ['stopped', 'arriving'].includes(snapshot.state)
    ? station
    : (nextStation ?? station);
  const transfers = transferNames(transferStation, language);
  const guidanceStation = snapshot.state === 'approaching' ? (nextStation ?? station) : station;
  const details = guidanceStation.platformByDirection[snapshot.direction];
  const transferKey = transferStation.transfers
    .map((item) => (item.kind === 'badge' ? item.code : JSON.stringify(item.names)))
    .join(',');
  const facilityKey =
    details?.facilities
      .map((item) => `${item.kind}:${item.car}:${item.relativePosition}:${item.label}`)
      .join(',') ?? '';
  const side = guidanceStation.doorByDirection[snapshot.direction]?.side ?? 'unknown';
  const clock = config.clock ?? '12:00';
  const currentCar = carNumber(config.currentCar, line.carCount) ?? 1;
  const invalidationKey = [
    snapshot.line,
    snapshot.direction,
    snapshot.station,
    snapshot.next,
    snapshot.state,
    snapshot.doors,
    snapshot.remainingMinutes,
    page,
    language,
    headerLanguage,
    side,
    transferKey,
    facilityKey,
    currentCar,
    line.id === 'yamanote' ? clock : '',
    iconsRotate ? iconPhase : '',
  ].join('|');
  return Object.freeze({
    page,
    language,
    headerLanguage,
    languages: Object.freeze(abnormal ? [...INCIDENT_LANGUAGES] : languages),
    line,
    snapshot: Object.freeze({ ...snapshot }),
    station,
    nextStation,
    guidanceStation,
    transferStation,
    clock,
    destination,
    transfers: Object.freeze(transfers),
    route: Object.freeze(route),
    nearby: Object.freeze(nearby),
    sideLabel: sideLabel(snapshot, guidanceStation, config.viewingSide ?? 'right'),
    currentCar,
    viewingSide: config.viewingSide ?? 'right',
    visibleElapsed,
    pageDeadline,
    languageDeadline,
    iconPhase,
    nextDeadline: earliest(pageDeadline, languageDeadline, iconDeadline),
    invalidationKey,
  });
}

export function stationMinutes(model: ScreenSchedule, code: string): number | null {
  const index = model.route.findIndex((station) => station.code === code);
  return index < 0
    ? null
    : Math.ceil((model.snapshot.remainingMinutes * index) / Math.max(1, model.route.length - 1));
}
