export type DoorSide = 'left' | 'right' | 'both' | 'unknown';
export type FacilityKind =
  'stairs' | 'escalator' | 'lift' | 'toilet' | 'gate' | 'exit' | 'transfer';

export interface SideEvidence {
  direction: string;
  side: Exclude<DoorSide, 'unknown'>;
  source: string;
  revision?: string;
}

export interface PlatformFacility {
  kind: FacilityKind;
  car: number | null;
  relativePosition: number | null;
  label: string;
  source: string;
  revision: string;
}

export interface DoorDirectionDetail {
  side: DoorSide;
  provenance: string;
  sources: readonly SideEvidence[];
  synthetic: boolean;
}
export interface PlatformDirectionDetail {
  carOrder: readonly number[];
  facilities: readonly PlatformFacility[];
  provenance: string;
  synthetic: boolean;
}
export interface StationDirectionDetails {
  doorByDirection: Readonly<Record<string, DoorDirectionDetail>>;
  platformByDirection: Readonly<Record<string, PlatformDirectionDetail>>;
}

export interface TransferSupplement {
  codes?: readonly string[];
  text?: Readonly<{ ja?: string; en?: string }>;
  source: string;
  revision: string;
}

const TOKYO_METRO = 'https://www.tokyometro.jp/station/line_hibiya/index.html';
const TOKYO_GINZA = 'https://www.tokyometro.jp/station/line_ginza/index.html';
const TOKYO_YURAKUCHO = 'https://www.tokyometro.jp/station/line_yurakucho/index.html';
const TOKYO_HANZOMON = 'https://www.tokyometro.jp/station/line_hanzomon/index.html';
const TOEI_IWAMOTOCHO = 'https://www.kotsu.metro.tokyo.jp/eng/subway_stations/iwamotocho.html';
const TOKYO_UENO_HIROKOJI = 'https://www.tokyometro.jp/station/ueno-hirokoji/index.html';
const OSAKA_METRO = 'https://subway.osakametro.co.jp/en/station_guide/';

export const transferSupplements: Readonly<
  Record<string, Readonly<Record<string, TransferSupplement>>>
> = {
  hibiya: {
    H02: { text: { ja: 'JR線', en: 'JR Line' }, source: TOKYO_METRO, revision: '2026-10-24' },
    H06: { codes: ['G07'], source: TOKYO_GINZA, revision: '2026-10-24' },
    H08: { codes: ['Y18'], source: TOKYO_YURAKUCHO, revision: '2026-10-24' },
    H09: { codes: ['Y19'], source: TOKYO_YURAKUCHO, revision: '2026-10-24' },
    H11: { codes: ['Y20'], source: TOKYO_YURAKUCHO, revision: '2026-10-24' },
    H14: { codes: ['Z10'], source: TOKYO_HANZOMON, revision: '2026-10-24' },
    H16: {
      codes: ['S08'],
      text: { ja: 'JR線・つくばエクスプレス', en: 'JR Lines and Tsukuba Express' },
      source: TOEI_IWAMOTOCHO,
      revision: '2026-10-24',
    },
    H17: { codes: ['G15', 'E09'], source: TOKYO_UENO_HIROKOJI, revision: '2026-10-24' },
    H18: {
      text: { ja: 'JR線・京成線', en: 'JR Lines and Keisei Line' },
      source: TOKYO_METRO,
      revision: '2026-10-24',
    },
  },
  sakaisuji: {
    K11: {
      text: { ja: '阪急線（相互直通）', en: 'Hankyu Line (mutual through operation)' },
      source: OSAKA_METRO,
      revision: '2026-10-24',
    },
    K12: { text: { ja: 'JR線', en: 'JR Line' }, source: OSAKA_METRO, revision: '2026-10-24' },
    K13: { text: { ja: 'JR線', en: 'JR Line' }, source: OSAKA_METRO, revision: '2026-10-24' },
    K14: { text: { ja: '京阪線', en: 'Keihan Line' }, source: OSAKA_METRO, revision: '2026-10-24' },
    K17: {
      text: { ja: '近鉄線', en: 'Kintetsu Line' },
      source: OSAKA_METRO,
      revision: '2026-10-24',
    },
    K18: { text: { ja: '阪堺線', en: 'Hankai Line' }, source: OSAKA_METRO, revision: '2026-10-24' },
    K19: {
      text: { ja: 'JR線・阪堺線・南海線', en: 'JR, Hankai and Nankai Lines' },
      source: OSAKA_METRO,
      revision: '2026-10-24',
    },
    K20: { text: { ja: '南海線', en: 'Nankai Line' }, source: OSAKA_METRO, revision: '2026-10-24' },
  },
};

export function buildDirectionDetails(
  directions: readonly string[],
  carCount: number,
  evidence: readonly SideEvidence[] = [],
): StationDirectionDetails {
  if (!Number.isInteger(carCount) || carCount < 1 || carCount > 20)
    throw new Error(`Invalid formation car count: ${carCount}`);
  if (
    !directions.length ||
    new Set(directions).size !== directions.length ||
    directions.some((direction) => !direction)
  ) {
    throw new Error('Directions must be non-empty and unique');
  }
  const evidenceByDirection = new Map<string, SideEvidence[]>();
  for (const item of evidence) {
    if (!directions.includes(item.direction))
      throw new Error(`Unknown door-side direction: ${item.direction}`);
    if (!['left', 'right', 'both'].includes(item.side) || !item.source.trim()) {
      throw new Error(`Invalid door-side evidence for ${item.direction}`);
    }
    const list = evidenceByDirection.get(item.direction) ?? [];
    list.push(item);
    evidenceByDirection.set(item.direction, list);
  }
  const doorByDirection: Record<string, DoorDirectionDetail> = {};
  const platformByDirection: Record<string, PlatformDirectionDetail> = {};
  for (const direction of directions) {
    const sources = evidenceByDirection.get(direction) ?? [];
    const sides = new Set(sources.map((item) => item.side));
    const conflict = sides.size > 1;
    const hasEvidence = sources.length > 0 && !conflict;
    const side = hasEvidence ? sources[0].side : 'unknown';
    const door: DoorDirectionDetail = Object.freeze({
      side,
      provenance: conflict
        ? `Conflicting direction-specific source entries: ${sources.map((item) => item.source).join(', ')}`
        : hasEvidence
          ? sources.map((item) => item.source).join(', ')
          : 'No direction-specific platform-side data; synthetic unknown',
      sources: Object.freeze(sources.map((item) => Object.freeze({ ...item }))),
      synthetic: !hasEvidence,
    });
    doorByDirection[direction] = door;
    platformByDirection[direction] = Object.freeze({
      carOrder: Object.freeze(Array.from({ length: carCount }, (_, index) => index + 1)),
      facilities: Object.freeze([]),
      provenance: 'No verified station platform layout; synthetic empty facilities',
      synthetic: true,
    });
  }
  return Object.freeze({
    doorByDirection: Object.freeze(doorByDirection),
    platformByDirection: Object.freeze(platformByDirection),
  });
}
