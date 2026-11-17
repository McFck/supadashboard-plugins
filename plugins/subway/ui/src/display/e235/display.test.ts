import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines } from '../../simulation/lines';
import type { RunSnapshot } from '../../simulation/run';
import { scheduleScreen, sessionKey } from '../../rendering/screens';
import { PhaseClock } from '../../rendering/engine/phase-clock';
import { drawE235Overlay } from './overlay';
import { lineFactsFor } from '../../data/load';
import { drawE235RouteMap, e235LoopCell } from './route-map';
import { e235Data, e235Minutes, e235TrainStop, e235TransferLayout } from './data';
import { e235Routine } from './schedule';
import { e235DoorFrame } from './door';
import { drawE235Page } from './pages';
import { e235PackPlatformObjects } from './platform';

const lineFiles = import.meta.glob('../../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
});
const packFiles = import.meta.glob('../../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
});
const line = normalizeSubwayLines(
  ['yamanote', 'hibiya', 'sakaisuji'].map((id) => ({
    line: Object.entries(lineFiles).find(([p]) => p.endsWith(`/${id}/line.json`))![1],
    pack: Object.entries(packFiles).find(([p]) => p.endsWith(`/${id}/pack.json`))![1],
  })),
)[0]!;
const snapshot: RunSnapshot = {
  station: 'JY13',
  next: 'JY14',
  state: 'cruising',
  line: 'yamanote',
  direction: 'inner',
  doorSide: 'left',
  doors: 'closed',
  speed: 40,
  power: 0,
  brake: 0,
  progress: 0.4,
  paused: false,
  immersion: false,
  generation: 1,
  multiplier: 1,
  remainingMinutes: 60,
};

describe('NextStation E235 data and routines', () => {
  it('uses stopping markers through door opening and closing rather than empty yellow time circles', () => {
    for (const state of [
      'stopped',
      'arriving',
      'doorsClosing',
      'departing',
      'cruising',
      'approaching',
    ] as const) {
      const fills: string[] = [],
        labels: string[] = [];
      let color = '';
      const ctx = new Proxy(
        {},
        {
          get(_target, key) {
            if (key === 'measureText') return () => ({ width: 10 });
            if (key === 'fill') return () => fills.push(color);
            if (key === 'fillText') return (value: string) => labels.push(value);
            return () => {};
          },
          set(_target, key, value) {
            if (key === 'fillStyle') color = String(value);
            return true;
          },
        },
      ) as CanvasRenderingContext2D;
      const model = {
        ...scheduleScreen({ ...snapshot, state }, { line, languages: ['ja'] }, 0),
        page: 'broad' as const,
      };
      drawE235RouteMap(ctx, model);
      const stationary = ['stopped', 'arriving', 'doorsClosing'].includes(state);
      expect(
        fills.filter((color) => color === '#ffe000'),
        state,
      ).toHaveLength(stationary ? 0 : 1);
      if (!stationary) expect(labels, state).toContain('2');
      drawE235Overlay(ctx, model, 400);
      expect(fills, state).toContain('#a00000');
    }
  });
  it('wakes at each icon rotation while a multi-icon transfer page is shown', () => {
    const stopped = { ...snapshot, state: 'stopped' as const };
    const samples = Array.from({ length: 120 }, (_, i) =>
      scheduleScreen(stopped, { line, languages: ['ja'] }, i * 500),
    ).filter((schedule) => schedule.page === 'transfers');
    expect(samples.length).toBeGreaterThan(0);
    for (const schedule of samples) {
      const boundary = (Math.floor(schedule.visibleElapsed / 3000) + 1) * 3000;
      expect(schedule.nextDeadline).toBeLessThanOrEqual(boundary);
    }
    expect(new Set(samples.map((schedule) => schedule.invalidationKey)).size).toBeGreaterThan(1);
  });
  it('changes the selected car without restarting the display cycle or reusing the old cached drawing', () => {
    const clock = new PhaseClock();
    const key = sessionKey(snapshot, { line });
    const first = scheduleScreen(snapshot, { line, currentCar: 1 }, clock.elapsed(key, 0));
    const selected = scheduleScreen(snapshot, { line, currentCar: 3 }, clock.elapsed(key, 4000));
    expect(selected.currentCar).toBe(3);
    expect(selected.visibleElapsed).toBe(4000);
    expect(selected.invalidationKey).not.toBe(first.invalidationKey);
  });
  it('fits the lower-row two-column alias into the source 115px viewbox with its 20px spacer', () => {
    const scales: number[][] = [];
    const ctx = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'scale') return (x: number, y: number) => scales.push([x, y]);
          if (key === 'measureText') return () => ({ width: 10 });
          return () => {};
        },
      },
    ) as CanvasRenderingContext2D;
    drawE235RouteMap(ctx, scheduleScreen(snapshot, { line, languages: ['ja'] }, 0));
    expect(scales).toContainEqual([39 / 50, 115 / (20 + 6 * 25)]);
  });
  it('measures and draws the Japanese notice JR span in its source font', () => {
    const measured: { value: string; font: string }[] = [],
      drawn: typeof measured = [];
    const ctx = {
      font: '',
      strokeRect() {},
      fillRect() {},
      save() {},
      restore() {},
      translate() {},
      scale() {},
      measureText(value: string) {
        measured.push({ value, font: this.font });
        return { width: value.length * 20 };
      },
      fillText(value: string) {
        drawn.push({ value, font: this.font });
      },
    };
    drawE235Page(ctx as unknown as CanvasRenderingContext2D, {
      ...scheduleScreen(snapshot, { line, languages: ['ja'] }, 0),
      page: 'notice',
    });
    expect(drawn.find((run) => run.value === 'JR')?.font).toContain('Microsoft Sans Serif');
    expect(
      measured
        .filter((run) => run.value === 'JR')
        .every((run) => run.font.includes('Microsoft Sans Serif')),
    ).toBe(true);
    expect(drawn.find((run) => run.value === 'ただいま、')?.font).toBe(
      '700 25px Meiryo, "Yu Gothic UI", sans-serif',
    );
  });
  it('matches the door Storyboard at every keyframe and resets at six seconds', () => {
    expect([0, 1000, 2000, 3000, 4000, 5999, 6000].map(e235DoorFrame)).toEqual([
      { width: 120, arrowY: 120 },
      { width: 120, arrowY: 120 },
      { width: 160, arrowY: 120 },
      { width: 200, arrowY: 100 },
      { width: 200, arrowY: 0 },
      { width: 200, arrowY: 0 },
      { width: 120, arrowY: 120 },
    ]);
  });
  it('packs adjacent stairs and escalators while retaining the elevator in a three-object group', () => {
    const objects = [
      { key: 'Elevator', direction: 'None', position: 'Front' },
      { key: 'UpStairs', direction: 'Opposite', position: 'Front' },
      { key: 'UpEscalator', direction: 'Opposite', position: 'Front' },
    ];
    expect(e235PackPlatformObjects(objects).map((g) => g.map((o) => o.key))).toEqual([
      ['Elevator'],
      ['UpStairs', 'UpEscalator'],
    ]);
    expect(
      e235PackPlatformObjects([{ ...objects[1]!, direction: 'Forward' }, objects[2]!]),
    ).toHaveLength(2);
  });
  it('keeps the native fixed loop geometry', () => {
    const map = lineFactsFor('yamanote')!.loopMap!;
    expect(e235LoopCell(map, 'JY16')).toEqual({ index: 0, upper: true });
    expect(e235LoopCell(map, 'JY02')).toEqual({ index: 14, upper: true });
    expect(e235LoopCell(map, 'JY17')).toEqual({ index: 0, upper: false });
    expect(e235LoopCell(map, 'JY01')).toEqual({ index: 14, upper: false });
  });
  it('accumulates train-setting minutes, including three-minute intervals in both directions', () => {
    const model = scheduleScreen(snapshot, { line }, 0);
    const minutes = e235Minutes(snapshot, model.route);
    expect(['JY17', 'JY18', 'JY19', 'JY20', 'JY21'].map((code) => minutes.get(code))).toEqual([
      8, 10, 12, 15, 17,
    ]);
    expect(e235TrainStop('JY21', 'outer').arrivalTime).toBe(3);
    expect(e235TrainStop('JY21', 'inner').arrivalTime).toBe(2);
  });
  it('uses language- and direction-specific transfer references, aliases and icon types', () => {
    const layout = e235TransferLayout('JY05', 'inner', 'DetailedRouteMap', 'en');
    expect(layout).toMatchObject({ rows: 5, columns: 2 });
    expect(layout.lines.map((l) => l.ref)).toEqual([0, 1, 2, 3, 5, 6, 7]);
    expect(layout.lines[0]!.aliasEn).toContain('\n');
    const outer = e235TransferLayout('JY05', 'outer', 'DetailedRouteMap', 'en');
    expect(outer.lines.map((l) => l.ref)).toEqual([0, 1, 2, 3, 4, 6, 7]);
    const ikebukuro = e235TransferLayout('JY13', 'inner', 'Transfers', 'ja');
    expect(ikebukuro.lines[0]!.iconRef).toBe(1);
    expect(ikebukuro.lines[0]!.transfer.icons[ikebukuro.lines[0]!.iconRef!]!.color).toBe('#ff2a00');
    expect(ikebukuro.lines.map((l) => l.transfer.icons[0]!.shape)).toEqual([
      'letter-box',
      'letter-box',
      'train',
      'train',
      'ring',
      'ring',
      'ring',
    ]);
  });
  it('uses the actual routine index rather than inferring a cycle from connection count', () => {
    const routine = e235Routine(snapshot, 0, 'left', ['ja', 'en', 'kana']);
    expect(routine).toMatchObject({
      page: 'broad',
      language: 'ja',
      headerLanguage: 'ja',
      pageDeadline: 12000,
      languageDeadline: 3000,
    });
    expect(e235Routine(snapshot, 3000, 'left', ['ja', 'en', 'kana']).headerLanguage).toBe('en');
    expect(e235Routine(snapshot, 6000, 'left', ['ja', 'en', 'kana']).headerLanguage).toBe('kana');
    expect(e235Routine(snapshot, 6000, 'left', ['ja', 'en']).headerLanguage).toBe('kana');
    expect(e235Routine(snapshot, 24000, 'left', ['ja', 'en']).language).toBe('en');
    expect(e235Routine(snapshot, 48000, 'left', ['ja', 'en']).page).toBe('platform');
    const threeMinute = { ...snapshot, station: 'JY22', next: 'JY21', direction: 'outer' };
    expect(
      [72000, 84000, 96000, 102000].map(
        (t) => e235Routine(threeMinute, t, 'left', ['ja', 'en']).page,
      ),
    ).toEqual(['notice', 'notice', 'priority', 'mobile']);
  });
  it('shows the complete source cycle in a shortened run and keeps its clock through acceleration', () => {
    const moving = { ...snapshot, station: 'JY14', next: 'JY15', screenRunDurationMs: 36_000 };
    const clock = new PhaseClock(),
      config = { line, languages: ['ja', 'en'] };
    const at = (state: RunSnapshot, now: number) =>
      scheduleScreen(state, config, clock.elapsed(sessionKey(state, config), now));
    expect(at({ ...moving, state: 'departing' }, 0).page).toBe('broad');
    expect(at(moving, 10_000).visibleElapsed).toBe(10_000);
    const transfer = at(moving, 24_000);
    expect(transfer.page).toBe('transfers');
    expect(transfer.pageDeadline).toBe(30_000);
    expect(at(moving, 30_000).page).toBe('platform');
  });
  it('distinguishes the native initial matrix row from later and final loop visits', () => {
    expect(e235TrainStop('JY13', 'inner', 'initial').arrivalTime).toBe(0);
    expect(e235TrainStop('JY13', 'inner', 'regular').use).toBe('ExceptLastLoop');
    expect(e235TrainStop('JY13', 'inner', 'last').use).toBe('LastLoopOnly');
    const initial = { ...snapshot, state: 'stopped' as const, initialStop: true };
    expect(e235Routine(initial, 0, 'right', ['ja', 'en']).page).toBe('broad');
    expect(e235Routine({ ...initial, initialStop: false }, 0, 'right', ['ja', 'en']).page).toBe(
      'transfers',
    );
    expect(e235Routine({ ...initial, initialStop: false }, 0, 'left', ['ja', 'en']).page).toBe(
      'broad',
    );
  });
  it('has a positive travel row, valid platform and valid routine for every stop in both directions', () => {
    for (const direction of ['inner', 'outer'])
      for (const station of e235Data.stations) {
        const row = e235TrainStop(station.code, direction);
        expect(row.arrivalTime).toBeGreaterThan(0);
        expect(station.platforms[row.platformRef!]).toBeDefined();
        for (const stage of [row.running, row.arriving, row.stopping])
          for (const side of ['Left', 'Right'] as const)
            expect(e235Data.optionalAreaRoutines[stage![side]!]?.steps.length).toBeGreaterThan(0);
      }
  });
});
