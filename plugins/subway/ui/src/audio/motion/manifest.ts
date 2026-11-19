import type { CarGeometry } from './joints';

export type Section = 'open' | 'tunnel';
/** Sparse `[km/h, value]` points, linearly interpolated. */
export type Curve = readonly (readonly [number, number])[];

export interface BveLayer {
  clip: string;
  power: Curve;
  brake: Curve;
  powerRate: Curve;
  brakeRate: Curve;
}

export type MotorProfile =
  | {
      kind: 'vvvf';
      levelDb: number;
      /** Gear ratio, wheel diameter (m) and pole pairs give the motor's electrical frequency from speed. */
      gear: number;
      wheel: number;
      polePairs: number;
      /** Asynchronous carrier in Hz by speed. */
      carrier: Curve;
      /** Synchronous modes: from each speed, the carrier is this many times the motor frequency. */
      sync: Curve;
      humDb: number;
    }
  | { kind: 'bve'; levelDb: number; layers: readonly BveLayer[]; rub: string; rubDb: number };

export interface TrainProfile {
  id: string;
  lines: readonly string[];
  car: CarGeometry;
  sections: {
    default: Section;
    stations: Readonly<Record<string, Section>>;
    /** `FROM-TO` in line order → progress at which the train crosses the portal. */
    portals: Readonly<Record<string, number>>;
  };
  termini: readonly string[];
  beds: {
    standing: string;
    hvac: string;
    rolling: Readonly<Partial<Record<Section, string>>>;
    platform: Readonly<Record<Section, string>>;
  };
  pools: { joint: readonly string[]; release: readonly string[]; rattle: readonly string[] };
  track: {
    jointSpacing: number;
    jointDb: number;
    jointCutoff: number;
    pointsChance: number;
    curveShare: number;
    curveDb: number;
    brakeSquealChance: number;
  };
  hvac: { levelDb: number; cutoff: number; cycleSeconds: readonly [number, number] };
  motor: MotorProfile;
}

export interface MotionClip {
  file: string;
  sha256: string;
}

export interface MotionManifest {
  version: 1;
  clips: Readonly<Record<string, MotionClip>>;
  trains: readonly TrainProfile[];
}

type Json = Record<string, unknown>;

function fail(at: string): never {
  throw new Error(`Invalid Subway motion manifest: ${at}`);
}

function object(value: unknown, at: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at);
  return value as Json;
}

function number(source: Json, key: string, at: string, min: number, max: number): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(`${at}.${key}`);
  return value;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value) fail(at);
  return value;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(at);
  return value;
}

function section(value: unknown, at: string): Section {
  if (value !== 'open' && value !== 'tunnel') fail(at);
  return value;
}

function curve(value: unknown, at: string): Curve {
  let previous = Number.NEGATIVE_INFINITY;
  return list(value, at).map((point, index) => {
    const pair = list(point, `${at}[${index}]`);
    const [x, y] = pair;
    if (pair.length !== 2 || typeof x !== 'number' || typeof y !== 'number')
      fail(`${at}[${index}]`);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < previous || y < 0)
      fail(`${at}[${index}]`);
    previous = x;
    return [x, y] as const;
  });
}

function record<T>(value: unknown, at: string, read: (item: unknown, at: string) => T) {
  return Object.fromEntries(
    Object.entries(object(value, at)).map(([key, item]) => [key, read(item, `${at}.${key}`)]),
  );
}

function readMotor(value: unknown, at: string, clip: (id: unknown, at: string) => string) {
  const motor = object(value, at);
  const levelDb = number(motor, 'levelDb', at, -60, 20);
  if (motor.kind === 'bve') {
    const layers = list(motor.layers, `${at}.layers`).map((item, index) => {
      const layer = object(item, `${at}.layers[${index}]`);
      const where = `${at}.layers[${index}]`;
      return {
        clip: clip(layer.clip, `${where}.clip`),
        power: curve(layer.power, `${where}.power`),
        brake: curve(layer.brake, `${where}.brake`),
        powerRate: curve(layer.powerRate, `${where}.powerRate`),
        brakeRate: curve(layer.brakeRate, `${where}.brakeRate`),
      };
    });
    const rub = clip(motor.rub, `${at}.rub`);
    return {
      kind: 'bve',
      levelDb,
      layers,
      rub,
      rubDb: number(motor, 'rubDb', at, -60, 20),
    } as const;
  }
  if (motor.kind !== 'vvvf') fail(`${at}.kind`);
  return {
    kind: 'vvvf',
    levelDb,
    gear: number(motor, 'gear', at, 1, 20),
    wheel: number(motor, 'wheel', at, 0.3, 1.5),
    polePairs: number(motor, 'polePairs', at, 1, 6),
    carrier: curve(motor.carrier, `${at}.carrier`),
    sync: curve(motor.sync, `${at}.sync`),
    humDb: number(motor, 'humDb', at, -60, 20),
  } as const;
}

function readTrain(value: unknown, at: string, clips: Readonly<Record<string, MotionClip>>) {
  const train = object(value, at);
  const clip = (id: unknown, where: string) => {
    const name = text(id, where);
    if (!Object.hasOwn(clips, name)) fail(where);
    return name;
  };
  const pool = (item: unknown, where: string) => {
    const ids = list(item, where).map((id, index) => clip(id, `${where}[${index}]`));
    if (!ids.length) fail(where);
    return ids;
  };
  const car = object(train.car, `${at}.car`);
  const sections = object(train.sections, `${at}.sections`);
  const beds = object(train.beds, `${at}.beds`);
  const pools = object(train.pools, `${at}.pools`);
  const track = object(train.track, `${at}.track`);
  const hvac = object(train.hvac, `${at}.hvac`);
  const platform = object(beds.platform, `${at}.beds.platform`);
  const [shortest, longest] = list(hvac.cycleSeconds, `${at}.hvac.cycleSeconds`);
  const cycle = { shortest, longest };
  const shortestCycle = number(cycle, 'shortest', `${at}.hvac.cycleSeconds`, 10, 3600);
  const longestCycle = number(cycle, 'longest', `${at}.hvac.cycleSeconds`, shortestCycle, 3600);
  const rolling = record(beds.rolling, `${at}.beds.rolling`, clip);
  const fallback = section(sections.default, `${at}.sections.default`);
  if (
    !Object.keys(rolling).every((key) => key === 'open' || key === 'tunnel') ||
    !rolling[fallback]
  )
    fail(`${at}.beds.rolling`);
  return {
    id: text(train.id, `${at}.id`),
    lines: list(train.lines, `${at}.lines`).map((line, index) =>
      text(line, `${at}.lines[${index}]`),
    ),
    car: {
      length: number(car, 'length', `${at}.car`, 5, 40),
      bogieCentres: number(car, 'bogieCentres', `${at}.car`, 2, 30),
      wheelbase: number(car, 'wheelbase', `${at}.car`, 1, 4),
    },
    sections: {
      default: fallback,
      stations: record(sections.stations, `${at}.sections.stations`, section),
      portals: record(sections.portals, `${at}.sections.portals`, (item, where) =>
        number({ item }, 'item', where, 0, 1),
      ),
    },
    termini: list(train.termini, `${at}.termini`).map((code, index) =>
      text(code, `${at}.termini[${index}]`),
    ),
    beds: {
      standing: clip(beds.standing, `${at}.beds.standing`),
      hvac: clip(beds.hvac, `${at}.beds.hvac`),
      rolling,
      platform: {
        open: clip(platform.open, `${at}.beds.platform.open`),
        tunnel: clip(platform.tunnel, `${at}.beds.platform.tunnel`),
      },
    },
    pools: {
      joint: pool(pools.joint, `${at}.pools.joint`),
      release: pool(pools.release, `${at}.pools.release`),
      rattle: pool(pools.rattle, `${at}.pools.rattle`),
    },
    track: {
      jointSpacing: number(track, 'jointSpacing', `${at}.track`, 10, 500),
      jointDb: number(track, 'jointDb', `${at}.track`, -60, 20),
      jointCutoff: number(track, 'jointCutoff', `${at}.track`, 200, 20_000),
      pointsChance: number(track, 'pointsChance', `${at}.track`, 0, 1),
      curveShare: number(track, 'curveShare', `${at}.track`, 0, 1),
      curveDb: number(track, 'curveDb', `${at}.track`, -60, 20),
      brakeSquealChance: number(track, 'brakeSquealChance', `${at}.track`, 0, 1),
    },
    hvac: {
      levelDb: number(hvac, 'levelDb', `${at}.hvac`, -60, 20),
      cutoff: number(hvac, 'cutoff', `${at}.hvac`, 200, 20_000),
      cycleSeconds: [shortestCycle, longestCycle] as const,
    },
    motor: readMotor(train.motor, `${at}.motor`, clip),
  } satisfies TrainProfile;
}

export function parseMotionManifest(value: unknown): MotionManifest {
  const manifest = object(value, 'root');
  if (manifest.version !== 1) fail('version');
  const clips = record(manifest.clips, 'clips', (item, at) => {
    const entry = object(item, at);
    const file = text(entry.file, `${at}.file`);
    if (!/^motion\/clips\/[a-z0-9-]+(\/[a-z0-9-]+)*\.(opus|flac)$/.test(file)) fail(`${at}.file`);
    const sha256 = text(entry.sha256, `${at}.sha256`);
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail(`${at}.sha256`);
    return { file, sha256 };
  });
  const trains = list(manifest.trains, 'trains').map((train, index) =>
    readTrain(train, `trains[${index}]`, clips),
  );
  const lines = trains.flatMap((train) => train.lines);
  if (new Set(lines).size !== lines.length) fail('trains: a line has two trains');
  return { version: 1, clips, trains };
}
