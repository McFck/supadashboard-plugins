/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';
import doorSequenceSource from '../../../assets/motion/door-sequence.js?raw';
import {
  buildSegmentCuePlan,
  resolveCue,
  selectDirectionalEntries,
  selectStationEntries,
} from './sound-pack';
import { resolveAssetUrl } from './asset-loader';
import type {
  DoorSequenceApi,
  LoadedSubwayLine,
  RuntimeCue,
  RuntimeCueManifest,
  SegmentCuePlan,
} from './sound-types';
import { normalizeSubwayLines, stepStation, type RawLineBundle } from '../simulation/lines';
import { createRunState, reduceRun } from '../simulation/run';
import { segmentPlanKey, type SubwayCuePlans } from '../simulation/run-state';

const manifest: RuntimeCueManifest = {
  version: 1,
  inputs: {},
  cues: [
    {
      file: 'lines/yamanote/clips/voice/test.opus',
      offset: 0.1,
      duration: 2,
      audible_end: 1.8,
      gainByRole: { voice: 0.75, melody: 0.4 },
      sha256: 'a'.repeat(64),
      status: 'needs ear check',
      source: [{ source: 'test source', revision: 'round5' }],
    },
  ],
};
const packModules = import.meta.glob('../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, unknown>>;
const lineModules = import.meta.glob('../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const runtimeCatalogue = Object.values(
  import.meta.glob('../../../assets/motion/runtime-cues.json', {
    eager: true,
    import: 'default',
  }) as Record<string, RuntimeCueManifest>,
)[0];
const shippedBundles = Object.entries(packModules).map(([packPath, pack]) => ({
  line: lineModules[packPath.replace('/pack.json', '/line.json')],
  pack,
}));
const shippedLines = normalizeSubwayLines(shippedBundles as RawLineBundle[]);
// The planner is a classic script that exports through `module` when one exists; this package is ESM.
const doorModule = { exports: {} as DoorSequenceApi };
new Function('module', doorSequenceSource)(doorModule);
const realDoorSequence = doorModule.exports;

function referencedFiles(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) referencedFiles(item, result);
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.file === 'string') result.add(record.file);
    for (const [key, child] of Object.entries(record))
      if (key !== 'file') referencedFiles(child, result);
  }
  return result;
}

describe('Subway sound pack', () => {
  it('resolves clips only inside the plugin asset base', () => {
    expect(
      resolveAssetUrl('lines/yamanote/clips/a b.opus', 'http://plugin.localhost/subway/assets/'),
    ).toBe('http://plugin.localhost/subway/assets/lines/yamanote/clips/a%20b.opus');
    expect(() =>
      resolveAssetUrl('../outside.opus', 'http://plugin.localhost/subway/assets/'),
    ).toThrow(/Unsafe/);
    expect(() =>
      resolveAssetUrl('/outside.opus', 'http://plugin.localhost/subway/assets/'),
    ).toThrow(/Unsafe/);
    expect(() => resolveAssetUrl('a.opus', 'http://plugin.localhost/other/assets/')).toThrow(
      /must stay under/,
    );
  });

  it('uses measured offsets and the requested role gain without changing review status', () => {
    const cue = resolveCue(
      { file: manifest.cues[0].file },
      'voice',
      manifest,
      'http://plugin.localhost/subway/assets/',
    );
    expect(cue).toMatchObject({
      offset: 0.1,
      duration: 2,
      audible_end: 1.8,
      gain: 0.75,
      status: 'needs ear check',
    });
    expect(cue.url).toContain('/subway/assets/lines/yamanote/clips/voice/test.opus');
    expect(() =>
      resolveCue(
        { file: manifest.cues[0].file },
        'bell',
        manifest,
        'http://plugin.localhost/subway/assets/',
      ),
    ).toThrow(/Missing bell catalogue entry/);
  });

  it('catalogues every pack clip, including station-specific door variants', () => {
    const referenced = new Set(
      Object.values(packModules).flatMap((pack) => [...referencedFiles(pack)]),
    );
    const catalogued = new Set(runtimeCatalogue.cues.map((cue) => cue.file));
    expect([...referenced].filter((file) => !catalogued.has(file))).toEqual([]);
  });

  it('uses the Sakaisuji pack departure melody when station records omit it', () => {
    const bundle: LoadedSubwayLine = {
      line: {},
      pack: packModules['../../../assets/lines/sakaisuji/pack.json'],
    };
    const plan = buildSegmentCuePlan(
      bundle,
      'K11',
      'K12',
      'southbound',
      ['ja', 'en'],
      false,
      runtimeCatalogue,
      'http://plugin.localhost/subway/assets/',
      realDoorSequence,
    );
    expect(plan.close.events.map((event) => event.part)).toEqual(['departure_melody', 'close']);
  });

  it('builds real door plans for every shipped station and direction', () => {
    for (const line of shippedLines) {
      const bundle: LoadedSubwayLine = {
        line: {},
        pack: packModules[`../../../assets/lines/${line.id}/pack.json`],
      };
      for (const station of line.stations)
        for (const direction of line.directions) {
          const next = stepStation(line, station.code, direction.id);
          const targets = next ? [next, station] : [station];
          for (const target of targets) {
            expect(
              () =>
                buildSegmentCuePlan(
                  bundle,
                  station.code,
                  target.code,
                  direction.id,
                  ['ja', 'en'],
                  target.transfers.length > 0,
                  runtimeCatalogue,
                  'http://plugin.localhost/subway/assets/',
                  realDoorSequence,
                ),
              `${line.id} ${station.code} → ${target.code} ${direction.id}`,
            ).not.toThrow();
          }
        }
    }
  });

  it('reduces real shipped door plans through close validation for every route and reaches the next station', () => {
    const plans: Record<string, SegmentCuePlan> = {};
    for (const line of shippedLines) {
      const bundle: LoadedSubwayLine = {
        line: {},
        pack: packModules[`../../../assets/lines/${line.id}/pack.json`],
      };
      for (const station of line.stations)
        for (const direction of line.directions) {
          const next = stepStation(line, station.code, direction.id);
          if (!next) continue;
          plans[segmentPlanKey(line.id, station.code, next.code, direction.id)] =
            buildSegmentCuePlan(
              bundle,
              station.code,
              next.code,
              direction.id,
              ['ja', 'en'],
              next.transfers.length > 0,
              runtimeCatalogue,
              'http://plugin.localhost/subway/assets/',
              realDoorSequence,
            );
        }
    }

    let checkedRoutes = 0;
    for (const line of shippedLines)
      for (const station of line.stations)
        for (const direction of line.directions) {
          const next = stepStation(line, station.code, direction.id);
          if (!next) continue;
          const state = createRunState(shippedLines, {
            lineId: line.id,
            stationCode: station.code,
            direction: direction.id,
            dwellSeconds: 0,
            now: 0,
          });
          const started = reduceRun(
            state,
            { type: 'start' },
            0,
            shippedLines,
            plans as SubwayCuePlans,
          ).state;
          const stopDeadline = started.stopDeadline ?? 0;
          let closed = started;
          for (let at = 0; at < stopDeadline; at += 250) {
            closed = reduceRun(
              closed,
              { type: 'tick' },
              Math.min(stopDeadline, at + 250),
              shippedLines,
              plans as SubwayCuePlans,
            ).state;
          }
          expect(
            () =>
              reduceRun(
                closed,
                { type: 'tick' },
                stopDeadline,
                shippedLines,
                plans as SubwayCuePlans,
              ),
            `${line.id} ${station.code} ${direction.id}`,
          ).not.toThrow();
          expect(
            reduceRun(closed, { type: 'tick' }, stopDeadline, shippedLines, plans as SubwayCuePlans)
              .state.phase,
          ).toBe('doorsClosing');
          checkedRoutes++;
        }
    expect(checkedRoutes).toBeGreaterThan(0);

    const yamanotePlan = plans[segmentPlanKey('yamanote', 'JY01', 'JY02', 'inner')]!;
    const shortenedPlatformCue = yamanotePlan.close.events.find(
      (event) => event.part === 'platform_open',
    )!.cue;
    expect(shortenedPlatformCue.duration).toBe(3.2);
    expect(shortenedPlatformCue.audible_end).toBe(shortenedPlatformCue.duration);

    let state = createRunState(shippedLines, {
      lineId: 'yamanote',
      stationCode: 'JY01',
      direction: 'inner',
      dwellSeconds: 0,
      now: 0,
    });
    state = reduceRun(state, { type: 'start' }, 0, shippedLines, plans as SubwayCuePlans).state;
    let at = 0;
    for (let transitions = 0; state.stationCode !== 'JY02' && transitions < 2_000; transitions++) {
      const deadline = state.stopDeadline ?? state.phaseDeadline ?? at + 250;
      at = Math.min(at + 250, deadline);
      state = reduceRun(state, { type: 'tick' }, at, shippedLines, plans as SubwayCuePlans).state;
    }
    expect(state.stationCode).toBe('JY02');
    expect(state.phase).toBe('arriving');
  });

  it('keeps close timing valid when neither the station nor pack has a departure melody', () => {
    const closeFile = 'lines/yamanote/clips/door/close.opus';
    const openFile = 'lines/yamanote/clips/door/open.opus';
    const noMelodyCatalogue: RuntimeCueManifest = {
      version: 1,
      inputs: {},
      cues: [closeFile, openFile].map((file) => ({
        file,
        offset: 0,
        duration: 1,
        audible_end: 0.8,
        gainByRole: { mechanics: 1 },
        sha256: 'd'.repeat(64),
        status: 'approved',
        source: 'fixture',
      })),
    };
    const line: LoadedSubwayLine = {
      line: {},
      pack: {
        id: 'yamanote',
        stations: [{ code: 'JY01' }, { code: 'JY02' }],
        doors: {
          close: { file: closeFile },
          open: { file: openFile },
          sequence: {
            close: [
              { part: 'departure_melody', at: 0 },
              { part: 'close', at: 'departure_melody_end+0.3' },
            ],
            open: [{ part: 'open', at: 0 }],
          },
        },
      },
    };
    const plan = buildSegmentCuePlan(
      line,
      'JY01',
      'JY02',
      'inner',
      [],
      false,
      noMelodyCatalogue,
      'http://plugin.localhost/subway/assets/',
      realDoorSequence,
    );
    expect(plan.close.events.map((event) => [event.part, event.at])).toEqual([['close', 0.3]]);
  });

  it('uses the line default once when a station-specific cue is unavailable', () => {
    const defaultFile =
      'lines/hibiya/clips/platform-door/platform-door_tokyo-metro-platform-door-ch_07.opus';
    const missingVariant =
      'lines/hibiya/clips/platform-door/platform-door_tokyo-metro-platform-door-ch_09.opus';
    const fallbackManifest: RuntimeCueManifest = {
      version: 1,
      inputs: {},
      cues: [
        {
          file: defaultFile,
          offset: 0,
          duration: 2,
          audible_end: 1.8,
          gainByRole: { signal: 0.5 },
          sha256: 'f'.repeat(64),
          status: 'needs ear check',
          source: 'fixture',
        },
      ],
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const record = { file: defaultFile, variants: [{ stations: ['H22'], file: missingVariant }] };
      const first = resolveCue(
        record,
        'signal',
        fallbackManifest,
        'http://plugin.localhost/subway/assets/',
        'H22',
      );
      const second = resolveCue(
        record,
        'signal',
        fallbackManifest,
        'http://plugin.localhost/subway/assets/',
        'H22',
      );
      expect(first.file).toBe(defaultFile);
      expect(second.file).toBe(defaultFile);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects wrong-direction singleton fallbacks and prefers exact over compatible entries', () => {
    const wrong = [{ file: 'outer.opus', direction: 'outer' }];
    expect(selectDirectionalEntries(wrong, 'inner')).toEqual([]);
    const entries = [
      { file: 'compatible.opus', directions: ['inner', 'outer'] },
      { file: 'exact.opus', direction: 'inner' },
      { file: 'duplicate.opus', direction: 'inner' },
      { file: 'duplicate.opus', direction: 'inner' },
    ];
    expect(selectDirectionalEntries(entries, 'inner').map((entry) => entry.file)).toEqual([
      'exact.opus',
      'duplicate.opus',
    ]);
  });

  it('requires station and kind matches before direction fallback', () => {
    const entries = [
      { file: 'wrong-direction.opus', station: 'H22', kind: 'next', direction: 'to-naka-meguro' },
      { file: 'wrong-station.opus', station: 'H21', kind: 'next', directions: ['to-kita-senju'] },
      { file: 'wrong-kind.opus', station: 'H22', kind: 'transfer', directions: ['to-kita-senju'] },
      { file: 'compatible.opus', station: 'H22', kind: 'next', directions: ['to-kita-senju'] },
    ];
    expect(
      selectStationEntries(entries, 'H22', 'next', 'to-kita-senju').map((entry) => entry.file),
    ).toEqual(['compatible.opus']);
  });

  it('places an available station melody before the door plan when its sequence omits it', () => {
    const melodyFile = 'lines/yamanote/clips/melody/station.opus';
    const catalogue: RuntimeCueManifest = {
      ...manifest,
      cues: [
        ...manifest.cues,
        {
          file: melodyFile,
          offset: 0,
          duration: 3,
          audible_end: 2.9,
          gainByRole: { melody: 0.4 },
          sha256: 'c'.repeat(64),
          status: 'approved',
          source: 'fixture',
        },
      ],
    };
    const line: LoadedSubwayLine = {
      line: {},
      pack: {
        id: 'yamanote',
        stations: [
          { code: 'JY01', departure_melody: { inner: { file: melodyFile } } },
          { code: 'JY02', next: {} },
        ],
        doors: {
          sequence: { close: [{ part: 'close', at: 0 }], open: [{ part: 'open', at: 0 }] },
          close: { file: 'lines/yamanote/clips/door/close.opus' },
          open: { file: 'lines/yamanote/clips/door/open.opus' },
        },
      },
    };
    const allFiles = [
      ...catalogue.cues,
      ...['close', 'open'].map((name) => ({
        file: `lines/yamanote/clips/door/${name}.opus`,
        offset: 0,
        duration: 1,
        audible_end: 0.9,
        gainByRole: { mechanics: 1 },
        sha256: 'd'.repeat(64),
        status: 'approved',
        source: 'fixture',
      })),
    ] as RuntimeCue[];
    const planner: DoorSequenceApi = { plan: () => ({ events: [], end: 0 }) };
    const segment = buildSegmentCuePlan(
      line,
      'JY01',
      'JY02',
      'inner',
      ['ja'],
      false,
      { ...catalogue, cues: allFiles },
      'http://plugin.localhost/subway/assets/',
      planner,
    );
    expect(segment.preClose?.[0]).toMatchObject({
      part: 'departure_melody',
      at: 0,
      cue: { file: melodyFile, gain: 0.4 },
    });
  });
});
