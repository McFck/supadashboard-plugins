import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines } from './simulation/lines';
import { scheduleScreen, stationMinutes } from './rendering/screens';
import { createSubwayScene, prepareFrame, type SubwaySceneData } from './rendering/scene';
import type { RunSnapshot } from './simulation/run';

const modules = import.meta.glob('../../assets/lines/*/{line,pack}.json', {
  eager: true,
  import: 'default',
});
const lines = normalizeSubwayLines(
  ['yamanote', 'hibiya', 'sakaisuji'].map((id) => ({
    line: Object.entries(modules).find(([path]) => path.endsWith(`/${id}/line.json`))![1],
    pack: Object.entries(modules).find(([path]) => path.endsWith(`/${id}/pack.json`))![1],
  })),
);
const snapshot: RunSnapshot = {
  line: 'yamanote',
  station: 'JY02',
  next: 'JY03',
  direction: 'inner',
  state: 'cruising',
  doors: 'closed',
  doorSide: 'unknown',
  remainingMinutes: 38,
  speed: 40,
  progress: 0.2,
  power: 0.3,
  brake: 0,
  paused: false,
  immersion: false,
  generation: 1,
  multiplier: 1,
};
const subwaySceneRevision = (scene: SubwaySceneData, view: string) =>
  prepareFrame(scene, view, 'left').revision;
const data: SubwaySceneData = {
  line: lines[0],
  snapshot,
  config: { displayLanguages: 'ja-en' },
  visibleElapsed: 0,
  wallMs: new Date(2026, 0, 1, 9, 41).getTime(),
};

describe('Subway v2 content and composition', () => {
  it('invalidates for visible content, independently of snapshot identity, audio, speed and widget updates', () => {
    const key = subwaySceneRevision(data, 'display');
    expect(
      subwaySceneRevision(
        {
          ...data,
          snapshot: { ...snapshot, progress: 0.9, speed: 52, immersion: true },
          config: { ...data.config, announcementVolume: 0.4 },
        },
        'display',
      ),
    ).toBe(key);
    expect(
      subwaySceneRevision({ ...data, wallMs: new Date(2026, 0, 1, 9, 42).getTime() }, 'display'),
    ).not.toBe(key);
    expect(
      subwaySceneRevision({ ...data, config: { ...data.config, carNumber: '3' } }, 'display'),
    ).not.toBe(key);
    expect(subwaySceneRevision({ ...data, visibleElapsed: 2_999 }, 'display')).toBe(key);
    expect(subwaySceneRevision({ ...data, visibleElapsed: 3_000 }, 'display')).not.toBe(key);
    expect(
      subwaySceneRevision({ ...data, snapshot: { ...snapshot, state: 'emergency' } }, 'display'),
    ).not.toBe(key);
  });

  it('resolves moving transfer information to the header station, and dwell information to the current station', () => {
    const moving = scheduleScreen(snapshot, { line: lines[0], languages: ['ja'] }, 16_000);
    const stopped = scheduleScreen(
      { ...snapshot, state: 'stopped' },
      { line: lines[0], languages: ['ja'] },
      0,
    );
    expect(moving.transferStation.code).toBe('JY03');
    expect(moving.transfers).toEqual(
      lines[0].stations[2].transfers.map((t) => (t.kind === 'text' ? t.names.ja : t.code)),
    );
    expect(stopped.transferStation.code).toBe('JY02');
    expect(stopped.transfers).not.toEqual(moving.transfers);
  });

  it('does not advertise the departure station door side or facilities during approach', () => {
    const line = {
      ...lines[0],
      stations: lines[0].stations.map((station, index) => ({
        ...station,
        doorByDirection: {
          ...station.doorByDirection,
          inner: {
            ...station.doorByDirection.inner,
            side: index === 0 ? ('left' as const) : ('unknown' as const),
          },
        },
      })),
    };
    const model = scheduleScreen(
      { ...snapshot, station: 'JY01', next: 'JY02', state: 'approaching' },
      { line },
      0,
    );
    expect(model.guidanceStation.code).toBe('JY02');
    expect(model.sideLabel).toBeNull();
    expect(model.guidanceStation.platformByDirection.inner).toBe(
      line.stations[1].platformByDirection.inner,
    );
  });

  it('derives monotonic stop estimates from controller journey time', () => {
    const model = scheduleScreen(snapshot, { line: lines[0] }, 0);
    expect(stationMinutes(model, model.route[0].code)).toBe(0);
    expect(stationMinutes(model, model.route.at(-1)!.code)).toBe(snapshot.remainingMinutes);
    const estimates = model.route.map((station) => stationMinutes(model, station.code)!);
    expect(estimates).toEqual([...estimates].sort((a, b) => a - b));
  });

  it('paints the live clock through the real scene renderer', () => {
    const texts: string[] = [],
      scales: number[][] = [];
    const target = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText: (text: string) => texts.push(text),
      scale: (...args: number[]) => scales.push(args),
    };
    const ctx = new Proxy(target, {
      get(object, key) {
        return key in object ? object[key as keyof typeof object] : () => {};
      },
    }) as unknown as CanvasRenderingContext2D;
    const scene = createSubwayScene();
    scene.draw({
      ctx,
      width: 1280,
      height: 720,
      mode: 'frozen',
      time: 0,
      view: 'display',
      data: prepareFrame(
        {
          ...data,
          visibleElapsed: 8_000,
          snapshot: { ...snapshot, direction: 'outer', next: 'JY01' },
        },
        'display',
        'left',
      ),
    });
    expect(texts).toEqual(expect.arrayContaining(['09', '41']));
    scene.dispose?.();
  });

  it.each([
    ['to-kita-senju', 'H13', 'H14', 1],
    ['to-naka-meguro', 'H14', 'H13', -1],
  ])(
    'paints Hibiya travel order and a cursor between the current and next stops toward %s',
    (direction, station, next, delta) => {
      const texts: string[] = [],
        path: number[][] = [];
      const target = {
        font: '',
        measureText: (text: string) => ({ width: text.length * 20 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        fillText: (text: string) => texts.push(text),
        moveTo: (x: number, y: number) => path.push([x, y]),
        lineTo: (x: number, y: number) => path.push([x, y]),
      };
      const ctx = new Proxy(target, {
        get(object, key) {
          return key in object ? object[key as keyof typeof object] : () => {};
        },
      }) as unknown as CanvasRenderingContext2D;
      const scene = createSubwayScene();
      const hibiya: SubwaySceneData = {
        line: lines[1],
        snapshot: {
          ...snapshot,
          line: 'hibiya',
          direction: String(direction),
          station: String(station),
          next: String(next),
        },
        config: { displayLanguages: 'ja-en' },
        visibleElapsed: 0,
      };
      for (const screen of ['left', 'right'] as const) {
        scene.draw({
          ctx,
          width: 1280,
          height: 720,
          mode: 'frozen',
          time: 0,
          view: 'display',
          data: prepareFrame(hibiya, 'display', screen),
        });
      }
      const codes = texts.filter((t) => /^H-\d/.test(t));
      expect(codes).toHaveLength(16);
      expect(codes).toEqual(
        [...codes].sort((a, b) => Number(delta) * (Number(a.slice(2)) - Number(b.slice(2)))),
      );
      const currentIndex = codes.indexOf(String(station).replace('H', 'H-'));
      expect(codes[currentIndex + 1]).toBe(String(next).replace('H', 'H-'));
      const arrow = path.findIndex((point, i) => point[1] === 484 && path[i + 1]?.[1] === 514);
      expect(arrow).toBeGreaterThanOrEqual(0);
      expect(path[arrow + 1][0] - path[arrow][0]).toBe(32);
      expect(path[arrow][0]).toBe(150 + 140 * (currentIndex % 8) + 70 - 28);
      scene.dispose?.();
    },
  );
});
