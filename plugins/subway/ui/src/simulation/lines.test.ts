import { describe, expect, it } from 'vitest';
import { localizedName, normalizeSubwayLine, normalizeSubwayLines, stepStation } from './lines';

const ids = ['yamanote', 'hibiya', 'sakaisuji'] as const;
interface FixtureStation {
  code: string;
  [key: string]: unknown;
}
interface FixtureLine {
  stations: FixtureStation[];
  color: string;
  transfers?: Record<string, unknown>;
  [key: string]: unknown;
}
interface FixturePack {
  stations: FixtureStation[];
  [key: string]: unknown;
}
interface Fixture {
  line: FixtureLine;
  pack: FixturePack;
}
const lineFiles = import.meta.glob('../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const packFiles = import.meta.glob('../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const load = (id: (typeof ids)[number]): Fixture => {
  const line = Object.entries(lineFiles).find(([file]) =>
    file.endsWith(`/lines/${id}/line.json`),
  )?.[1];
  const pack = Object.entries(packFiles).find(([file]) =>
    file.endsWith(`/lines/${id}/pack.json`),
  )?.[1];
  if (!line || !pack) throw new Error(`Missing Subway line fixtures: ${id}`);
  return { line: structuredClone(line) as FixtureLine, pack: structuredClone(pack) as FixturePack };
};
const bundles = ids.map(load);
const lines = normalizeSubwayLines(bundles);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('Subway line normalization', () => {
  it('normalizes the three current lines, 62 stations and 124 station-direction records', () => {
    expect(lines.map((line) => line.id)).toEqual(ids);
    expect(lines.reduce((sum, line) => sum + line.stations.length, 0)).toBe(62);
    expect(
      lines.reduce((sum, line) => sum + line.stations.length * line.directions.length, 0),
    ).toBe(124);
    expect(lines.map((line) => [line.code, line.carCount])).toEqual([
      ['JY', 11],
      ['H', 7],
      ['K', 8],
    ]);
    expect(lines[0].stations.map((station) => station.order)).toEqual(
      Array.from({ length: 30 }, (_, index) => index),
    );
    expect(lines[0].stations.find((station) => station.code === 'JY26')?.id).toBe('JY26');
    expect(lines[1].stations.find((station) => station.code === 'H06')?.id).toBe('H06');
    expect(lines[1].stations.find((station) => station.code === 'H14')?.id).toBe('H14');
    expect(lines[1].stations.find((station) => station.code === 'H22')?.id).toBe('H22');
    expect(lines[2].stations.find((station) => station.code === 'K20')?.order).toBe(9);
  });

  it('maps forward and reverse travel consistently and respects terminals', () => {
    const [yamanote, hibiya, sakaisuji] = lines;
    expect(yamanote.directions.map((direction) => [direction.id, direction.delta])).toEqual([
      ['inner', 1],
      ['outer', -1],
    ]);
    expect(hibiya.directions.map((direction) => [direction.id, direction.delta])).toEqual([
      ['to-kita-senju', 1],
      ['to-naka-meguro', -1],
    ]);
    expect(sakaisuji.directions.map((direction) => [direction.id, direction.delta])).toEqual([
      ['southbound', 1],
      ['northbound', -1],
    ]);
    expect(stepStation(yamanote, 'JY26', 'inner')?.code).toBe('JY27');
    expect(stepStation(yamanote, 'JY26', 'outer')?.code).toBe('JY25');
    expect(stepStation(yamanote, 'JY30', 'inner')?.code).toBe('JY01');
    expect(stepStation(yamanote, 'JY01', 'outer')?.code).toBe('JY30');
    expect(stepStation(hibiya, 'H06', 'to-kita-senju')?.code).toBe('H07');
    expect(stepStation(hibiya, 'H06', 'to-naka-meguro')?.code).toBe('H05');
    expect(stepStation(hibiya, 'H22', 'to-kita-senju')).toBeUndefined();
    expect(stepStation(sakaisuji, 'K20', 'southbound')).toBeUndefined();
    expect(stepStation(sakaisuji, 'K20', 'northbound')?.code).toBe('K19');
    expect(stepStation(sakaisuji, 'K11', 'northbound')).toBeUndefined();
  });

  it('preserves color metadata, coordinates and localized names without mutating source JSON', () => {
    const source = clone(load('hibiya'));
    const before = clone(source);
    const line = normalizeSubwayLine(source.line, source.pack);
    expect(line.color).toBe('#9CAEB7');
    expect(line.stations[0].coordinates).toMatchObject({
      lat: 35.644305555556,
      lon: 139.69918611111,
    });
    expect(localizedName(line.stations[0].names, 'xx')).toBe('Naka-Meguro');
    expect(localizedName(lines[0].stations[0].names, 'zh')).toBe('东京');
    expect(source).toEqual(before);
    expect(Object.isFrozen(line)).toBe(true);
    expect(Object.isFrozen(line.stations)).toBe(true);
    expect(Object.isFrozen(line.stations[0].names)).toBe(true);
    expect(Object.isFrozen(line.directions[0].names)).toBe(true);
  });

  it('keeps structured badges and complete localized transfer prose as separate union entries', () => {
    const yamanoteTokyo = lines[0].stations.find((station) => station.code === 'JY01')!;
    expect(yamanoteTokyo.transfers).toContainEqual(
      expect.objectContaining({
        kind: 'text',
        names: expect.objectContaining({
          ja: expect.stringContaining('京浜東北線'),
          en: expect.stringContaining('Chuo'),
        }),
      }),
    );
    expect(yamanoteTokyo.transfers.some((transfer) => transfer.kind === 'badge')).toBe(false);

    const hibiyaGinza = lines[1].stations.find((station) => station.code === 'H06')!;
    expect(hibiyaGinza.transfers).toContainEqual(
      expect.objectContaining({ kind: 'badge', code: 'G07' }),
    );
    const hibiyaIwamotocho = lines[1].stations.find((station) => station.code === 'H16')!;
    expect(hibiyaIwamotocho.transfers).toContainEqual(
      expect.objectContaining({ kind: 'badge', code: 'S08' }),
    );
    expect(hibiyaIwamotocho.transfers).toContainEqual(
      expect.objectContaining({
        kind: 'text',
        names: expect.objectContaining({
          ja: expect.stringContaining('つくば'),
          en: expect.stringContaining('Tsukuba'),
        }),
      }),
    );
    expect(lines[1].stations.find((station) => station.code === 'H14')?.transfers).toContainEqual(
      expect.objectContaining({ kind: 'badge', code: 'Z10' }),
    );
    expect(lines[2].stations.find((station) => station.code === 'K19')?.transfers).toContainEqual(
      expect.objectContaining({
        kind: 'text',
        names: expect.objectContaining({ en: expect.stringContaining('Hankai') }),
      }),
    );
  });

  it('uses only the explicit direction for platform-side evidence', () => {
    const tokyo = lines[0].stations.find((station) => station.code === 'JY01')!;
    expect(tokyo.doorByDirection.inner).toMatchObject({ side: 'left', synthetic: false });
    expect(tokyo.doorByDirection.outer).toMatchObject({ side: 'unknown', synthetic: true });
    expect(tokyo.platformByDirection.inner).toMatchObject({
      carOrder: Array.from({ length: 11 }, (_, i) => i + 1),
      facilities: [],
      synthetic: true,
    });
    const ebisu = lines[2].stations.find((station) => station.code === 'K18')!;
    expect(ebisu.doorByDirection.southbound).toMatchObject({ side: 'right', synthetic: false });
    expect(ebisu.doorByDirection.northbound).toMatchObject({ side: 'unknown', synthetic: true });
  });

  it('rejects duplicate ids, malformed codes and colors, bad coordinates, and broken references', () => {
    const duplicate = clone(load('yamanote'));
    duplicate.line.stations[1].code = duplicate.line.stations[0].code;
    duplicate.pack.stations[1].code = duplicate.line.stations[1].code;
    expect(() => normalizeSubwayLine(duplicate.line, duplicate.pack)).toThrow(
      /Duplicate station code/,
    );

    const reordered = clone(load('hibiya'));
    reordered.line.stations.reverse();
    reordered.pack.stations.reverse();
    expect(() => normalizeSubwayLine(reordered.line, reordered.pack)).toThrow(/catalogue lists/);

    const badCode = clone(load('hibiya'));
    badCode.line.stations[0].code = 'H1';
    expect(() => normalizeSubwayLine(badCode.line, badCode.pack)).toThrow(/Invalid station code/);

    const badColor = clone(load('sakaisuji'));
    badColor.line.color = 'brown';
    expect(() => normalizeSubwayLine(badColor.line, badColor.pack)).toThrow(/Invalid line color/);

    const badCoordinates = clone(load('hibiya'));
    badCoordinates.line.stations[0].lat = 91;
    expect(() => normalizeSubwayLine(badCoordinates.line, badCoordinates.pack)).toThrow(
      /invalid coordinates/i,
    );

    const badTransfer = clone(load('hibiya'));
    badTransfer.line.stations[5].transferCodes = ['G7'];
    expect(() => normalizeSubwayLine(badTransfer.line, badTransfer.pack)).toThrow(
      /Invalid transfer code/,
    );

    const badTransferReference = clone(load('yamanote'));
    badTransferReference.line.transfers ??= {};
    badTransferReference.line.transfers.INVALID = { en: 'Unknown stop' };
    expect(() => normalizeSubwayLine(badTransferReference.line, badTransferReference.pack)).toThrow(
      /unknown station/i,
    );
  });

  it('requires one unique bundle for every supported line', () => {
    expect(() => normalizeSubwayLines(bundles.slice(0, 2))).toThrow(/line catalog/i);
    expect(() => normalizeSubwayLines([...bundles, bundles[0]])).toThrow(/Duplicate Subway line/);
  });
});
