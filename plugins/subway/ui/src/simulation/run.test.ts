import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines, type RawLineBundle } from './lines';
import { createRunState, nextRunWake, reduceRun, snapshotRun } from './run';
import {
  segmentPlanKey,
  type RunEffect,
  type RunTransition,
  type SubwayCuePlans,
} from './run-state';

const modules = import.meta.glob('../../../assets/lines/*/{line,pack}.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const bundles: Record<string, RawLineBundle> = {};
for (const [path, value] of Object.entries(modules)) {
  const id = path.includes('/yamanote/')
    ? 'yamanote'
    : path.includes('/hibiya/')
      ? 'hibiya'
      : path.includes('/sakaisuji/')
        ? 'sakaisuji'
        : undefined;
  if (!id) continue;
  bundles[id] ??= { line: undefined, pack: undefined };
  if (path.endsWith('/line.json')) bundles[id].line = value;
  else bundles[id].pack = value;
}
const lines = normalizeSubwayLines(bundles);
const byId = (id: string) => lines.find((line) => line.id === id)!;
const plans: SubwayCuePlans = {};

function reduce(
  state: ReturnType<typeof createRunState>,
  type: Parameters<typeof reduceRun>[1]['type'],
  now: number,
  extra = {},
  cuePlans: SubwayCuePlans = plans,
) {
  return reduceRun(
    state,
    { type, ...extra } as Parameters<typeof reduceRun>[1],
    now,
    lines,
    cuePlans,
  );
}

function advanceTo(
  state: ReturnType<typeof createRunState>,
  target: number,
): { state: ReturnType<typeof createRunState>; effects: RunEffect[] } {
  return advanceWithPlans(state, target, plans);
}

function advanceWithPlans(
  state: ReturnType<typeof createRunState>,
  target: number,
  cuePlans: SubwayCuePlans,
): { state: ReturnType<typeof createRunState>; effects: RunEffect[] } {
  let current = state;
  const effects: RunEffect[] = [];
  for (let at = current.lastTickAt + 3_000; at <= target; at += 3_000) {
    const transition = reduceRun(current, { type: 'tick' }, at, lines, cuePlans);
    current = transition.state;
    effects.push(...transition.effects);
  }
  if (current.lastTickAt < target) {
    const transition = reduceRun(current, { type: 'tick' }, target, lines, cuePlans);
    current = transition.state;
    effects.push(...transition.effects);
  }
  return { state: current, effects };
}

describe('Subway run timeline', () => {
  it('keeps the selected station until zero-speed arrival, then opens before dwelling', () => {
    const journeyPlans: SubwayCuePlans = {
      [segmentPlanKey('yamanote', 'JY30', 'JY01', 'inner')]: {
        close: { events: [], end: 0 },
        open: { events: [], end: 2, open_end: 2 },
        departure: [],
        arrival: [],
      },
    };
    let state = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY30',
      direction: 'inner',
      now: 0,
    });
    state = reduce(state, 'start', 0, {}, journeyPlans).state;
    let stepped = advanceWithPlans(state, 15_000, journeyPlans);
    let transition: RunTransition = { state: stepped.state, effects: stepped.effects };
    state = transition.state;
    expect(state.phase).toBe('doorsClosing');
    expect(state.stationCode).toBe('JY30');
    transition = reduce(state, 'tick', state.phaseDeadline!, {}, journeyPlans);
    state = transition.state;
    expect(state.phase).toBe('departing');
    expect(transition.effects.filter((effect) => effect.type === 'departed')).toHaveLength(1);
    expect(state.segment?.to).toBe('JY01');
    const moving = snapshotRun(state, state.phaseStartedAt! + 2_000, lines);
    expect(moving.station).toBe('JY30');
    expect(moving.next).toBe('JY01');
    expect(moving.speed).toBeGreaterThan(0);
    expect(moving.progress).toBeGreaterThan(0);
    expect(moving.power * moving.brake).toBe(0);
    const arrivalAt = state.phaseDeadline! + state.segment!.cruiseMs + state.segment!.approachMs;
    const arrival = advanceWithPlans(state, arrivalAt, journeyPlans);
    transition = { state: arrival.state, effects: arrival.effects };
    state = transition.state;
    expect(state.phase).toBe('arriving');
    expect(state.stationCode).toBe('JY01');
    expect(state.doors).toBe('opening');
    expect(transition.effects.filter((effect) => effect.type === 'arrived')).toHaveLength(1);
    expect(snapshotRun(state, arrivalAt, lines).speed).toBe(0);
    expect(snapshotRun(state, arrivalAt, lines).brake).toBe(1);
    expect(snapshotRun(state, arrivalAt, lines).next).toBe('JY02');
    transition = reduce(state, 'tick', state.phaseDeadline!, {}, journeyPlans);
    expect(transition.state.phase).toBe('stopped');
    expect(transition.state.doors).toBe('open');
    expect(transition.state.stopDeadline).toBe(state.phaseDeadline! + 15_000);
  });

  it('keeps Yamanote running lap after lap and turns non-loop lines back at their terminals', () => {
    let state = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY30',
      direction: 'inner',
      dwellSeconds: 0,
    });
    state = reduce(state, 'start', 0).state;
    const arrivals: string[] = [];
    let now = 0;
    for (let guard = 0; guard < 31 * 65_000 && arrivals.length < 31; guard += 3_000) {
      now += 3_000;
      const transition = reduce(state, 'tick', now);
      state = transition.state;
      arrivals.push(
        ...transition.effects
          .filter(
            (effect): effect is Extract<RunEffect, { type: 'arrived' }> =>
              effect.type === 'arrived',
          )
          .map((effect) => effect.to),
      );
    }
    expect(arrivals).toHaveLength(31);
    expect(arrivals[0]).toBe('JY01');
    expect(arrivals[29]).toBe('JY30');
    expect(arrivals[30]).toBe('JY01');
    expect(state.laps).toBe(1);
    expect(state.active).toBe(true);
    expect(nextRunWake(state, now)).not.toBeNull();

    let hibiya = createRunState(lines, {
      lineId: 'hibiya',
      stationCode: 'H21',
      direction: 'to-kita-senju',
      dwellSeconds: 0,
    });
    hibiya = reduce(hibiya, 'start', 0).state;
    const departures: string[] = [];
    for (let at = 3_000; at < 4 * 65_000 && departures.length < 2; at += 3_000) {
      const transition = reduce(hibiya, 'tick', at);
      hibiya = transition.state;
      for (const effect of transition.effects)
        if (effect.type === 'departed') departures.push(`${effect.from}>${effect.to}`);
    }
    expect(departures).toEqual(['H21>H22', 'H22>H21']);
    expect(hibiya.direction).toBe('to-naka-meguro');
    expect(hibiya.laps).toBe(1);
  });

  it('applies speed changes on the next segment and preserves the current timeline with audio off', () => {
    const make = (immersion: boolean) => {
      let state = createRunState(lines, {
        lineId: 'hibiya',
        stationCode: 'H06',
        direction: 'to-kita-senju',
        immersion,
        dwellSeconds: 0,
      });
      state = reduce(state, 'start', 0).state;
      state = reduce(state, 'tick', 0).state;
      state = reduce(state, 'tick', state.phaseDeadline!).state;
      return state;
    };
    let on = make(true);
    let off = make(false);
    expect(on.phase).toBe('departing');
    expect(off.phase).toBe('departing');
    expect(on.segment?.departureMs).toBe(off.segment?.departureMs);
    const transition = reduce(on, 'set-speed', 1_000, { multiplier: 2 });
    on = transition.state;
    expect(on.segment?.multiplier).toBe(1);
    expect(on.nextMultiplier).toBe(2);
    expect(snapshotRun(on, 1_000, lines).power * snapshotRun(on, 1_000, lines).brake).toBe(0);
  });

  it('keeps safety phases at least 12s and estimates future dwell and door budgets to one loop', () => {
    let fast = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY30',
      direction: 'inner',
      multiplier: 2,
      dwellSeconds: 0,
    });
    fast = reduce(fast, 'start', 0).state;
    fast = reduce(fast, 'tick', 0).state;
    expect(fast.segment?.departureMs).toBeGreaterThanOrEqual(12_000);
    expect(fast.segment?.approachMs).toBeGreaterThanOrEqual(12_000);
    expect(fast.segment?.cruiseMs).toBeGreaterThanOrEqual(5_000);

    const atStation = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY30',
      direction: 'inner',
      dwellSeconds: 15,
    });
    const started = reduce(atStation, 'start', 0).state;
    expect(snapshotRun(started, 0, lines).remainingMinutes).toBe(38);
  });

  it('does not tick a hidden run, then resumes where a run that never paused would be', () => {
    let state = createRunState(lines, {
      lineId: 'sakaisuji',
      stationCode: 'K11',
      direction: 'southbound',
      now: 0,
    });
    state = reduce(state, 'start', 0).state;
    state = advanceTo(state, 15_000).state;
    const before = snapshotRun(state, state.lastTickAt, lines);
    const neverPaused = advanceTo(state, state.lastTickAt + 600_000).state;
    state = reduce(state, 'pause', state.lastTickAt).state;
    const wake = nextRunWake(state, 75_000);
    expect(wake).toBeNull();
    const hidden = reduce(state, 'tick', state.pausedAt! + 60_000);
    expect(hidden.effects).toEqual([]);
    expect(snapshotRun(hidden.state, state.pausedAt! + 60_000, lines)).toMatchObject({
      progress: before.progress,
      speed: before.speed,
      station: before.station,
    });
    const resumeAt = state.pausedAt! + 600_000;
    const resumed = reduce(hidden.state, 'resume', resumeAt);
    expect(resumed.effects).toEqual([]);
    const { paused, ...expected } = snapshotRun(neverPaused, resumeAt, lines);
    expect(paused).toBe(false);
    expect(expected.station).not.toBe('K11');
    expect(snapshotRun(resumed.state, resumeAt, lines)).toMatchObject(expected);
    expect(nextRunWake(resumed.state, resumeAt)).toBe(nextRunWake(neverPaused, resumeAt));
  });

  it('brakes on an idempotent emergency, then resumes the same segment without a second departure', () => {
    let state = createRunState(lines, {
      lineId: 'hibiya',
      stationCode: 'H06',
      direction: 'to-kita-senju',
      dwellSeconds: 0,
      now: 0,
    });
    state = reduce(state, 'start', 0).state;
    state = reduce(state, 'tick', 0).state;
    state = reduce(state, 'tick', state.phaseDeadline!).state;
    const segment = state.segment;
    const emergency = reduce(state, 'emergency', state.phaseStartedAt! + 3_000);
    state = emergency.state;
    expect(state.phase).toBe('emergency');
    expect(emergency.effects.filter((effect) => effect.type === 'emergency')).toHaveLength(1);
    const repeated = reduce(state, 'emergency', state.lastTickAt + 1_000);
    expect(repeated.effects).toEqual([]);
    const speedBeforeBrake = snapshotRun(state, state.incident!.startedAt, lines).speed;
    const braking = snapshotRun(state, state.incident!.startedAt + 1_000, lines);
    expect(braking.speed).toBeGreaterThan(0);
    expect(braking.speed).toBeLessThan(speedBeforeBrake);
    expect(braking.power).toBe(0);
    expect(braking.brake).toBe(1);
    expect(braking.progress).toBeGreaterThan(
      snapshotRun(state, state.incident!.startedAt, lines).progress,
    );
    state = reduce(state, 'tick', state.incident!.startedAt + 2_000).state;
    expect(snapshotRun(state, state.lastTickAt, lines).speed).toBe(0);
    const heldProgress = snapshotRun(state, state.lastTickAt, lines).progress;
    state = reduce(state, 'resume-service', state.lastTickAt + 1_000).state;
    expect(state.phase).toBe('departing');
    expect(state.segment?.from).toBe(segment?.from);
    expect(state.segment?.to).toBe(segment?.to);
    expect(state.generation).toBe(1);
    expect(snapshotRun(state, state.lastTickAt, lines).progress).toBe(heldProgress);
    expect(
      reduce(state, 'tick', state.phaseDeadline!).effects.some(
        (effect) => effect.type === 'departed',
      ),
    ).toBe(false);
  });

  it('defers a destination reached during emergency braking until recovery, then arrives once', () => {
    let state = createRunState(lines, {
      lineId: 'hibiya',
      stationCode: 'H06',
      direction: 'to-kita-senju',
      dwellSeconds: 0,
    });
    state = reduce(state, 'start', 0).state;
    state = reduce(state, 'tick', 0).state;
    state = advanceTo(state, state.phaseDeadline!).state;
    state = advanceTo(state, state.phaseDeadline!).state;
    state = advanceTo(state, state.phaseDeadline!).state;
    expect(state.phase).toBe('approaching');
    state = advanceWithPlans(state, state.phaseDeadline! - 1, plans).state;
    const emergency = reduce(state, 'emergency', state.lastTickAt);
    state = emergency.state;
    expect(emergency.effects.some((effect) => effect.type === 'arrived')).toBe(false);
    state = reduce(state, 'tick', state.incident!.startedAt + 2_000).state;
    expect(snapshotRun(state, state.lastTickAt, lines).progress).toBe(1);
    const recovered = reduce(state, 'resume-service', state.lastTickAt + 1_000);
    expect(recovered.state.phase).toBe('arriving');
    expect(recovered.effects.filter((effect) => effect.type === 'arrived')).toHaveLength(1);
    expect(
      recovered.effects.filter(
        (effect) => effect.type === 'state-changed' && effect.state === 'arriving',
      ),
    ).toHaveLength(1);
    expect(
      reduce(recovered.state, 'tick', recovered.state.phaseDeadline!).effects.some(
        (effect) => effect.type === 'arrived',
      ),
    ).toBe(false);
  });

  it('suspends with no fabricated emergency event and reports door state safely', () => {
    const line = byId('sakaisuji');
    const terminal = createRunState(lines, {
      lineId: line.id,
      stationCode: 'K11',
      direction: 'northbound',
    });
    const transition = reduce(terminal, 'suspend', 0);
    expect(transition.state.phase).toBe('suspended');
    expect(transition.effects.some((effect) => effect.type === 'suspended')).toBe(true);
    expect(transition.effects.some((effect) => effect.type === 'emergency')).toBe(false);
    expect(snapshotRun(transition.state, 0, lines).doorSide).toBe('unknown');
  });

  it('uses the immutable door plan anchors and never opens doors while moving', () => {
    const cue = {
      file: 'test.opus',
      offset: 0,
      duration: 1,
      audible_end: 0.8,
      gainByRole: { mechanics: 1 },
      sha256: 'a'.repeat(64),
      status: 'approved',
      source: 'test',
      gain: 1,
      url: '/subway/test.opus',
    };
    const plan: SubwayCuePlans = {
      [segmentPlanKey('yamanote', 'JY01', 'JY02', 'inner')]: {
        close: { events: [{ part: 'close', at: 0, cue }], end: 1, close_end: 0.8 },
        open: { events: [{ part: 'open', at: 0, cue }], end: 3, open_end: 2.5 },
        departure: [],
        arrival: [],
      },
    };
    let state = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY01',
      direction: 'inner',
      now: 0,
    });
    state = reduceRun(state, { type: 'start' }, 0, lines, plan).state;
    state = advanceWithPlans(state, 15_000, plan).state;
    const closeDeadline = state.phaseDeadline!;
    expect(state.pendingCues[0].at).toBe(15_000);
    state = reduceRun(state, { type: 'tick' }, closeDeadline, lines, plan).state;
    expect(state.phase).toBe('departing');
    expect(state.phaseDeadline! - state.phaseStartedAt!).toBeGreaterThanOrEqual(12_000);
    for (let at = state.phaseStartedAt!; at < state.phaseDeadline! + 1; at += 500) {
      const sample = snapshotRun(state, at, lines);
      expect(sample.speed >= 0 && sample.speed <= 60).toBe(true);
      expect(sample.power * sample.brake).toBe(0);
      if (sample.speed > 0) expect(sample.doors).toBe('closed');
    }
    const openAt = state.phaseDeadline! + state.segment!.cruiseMs + state.segment!.approachMs;
    const arrival = advanceWithPlans(state, openAt, plan);
    expect(arrival.state.phase).toBe('arriving');
    expect(arrival.state.phaseDeadline).toBe(openAt + 2_500);
    const played = arrival.effects.filter((effect) => effect.type === 'play-cue');
    expect(
      [...played, ...arrival.state.pendingCues].some((item) => item.id.includes(':open:')),
    ).toBe(true);
  });

  it('holds the brake at rest through door closing, then releases it at traction', () => {
    let state = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY01',
      direction: 'inner',
      dwellSeconds: 0,
    });
    expect(snapshotRun(state, 0, lines).brake).toBe(1);
    state = reduce(state, 'start', 0).state;
    state = reduce(state, 'tick', 0).state;
    expect(state.phase).toBe('doorsClosing');
    expect(snapshotRun(state, 599, lines).brake).toBe(1);
    expect(snapshotRun(state, 600, lines).brake).toBe(0);
    const departure = reduce(state, 'tick', 600);
    expect(departure.state.phase).toBe('departing');
    expect(snapshotRun(departure.state, 600, lines)).toMatchObject({ power: 1, brake: 0 });
  });

  it('keeps line selection changes inert and validates commands at the boundary', () => {
    const initial = createRunState(lines, { lineId: 'yamanote', stationCode: 'JY01' });
    const changed = reduceRun(
      initial,
      { type: 'configure', lineId: 'hibiya', direction: 'to-kita-senju', stationCode: 'H14' },
      10,
      lines,
    ).state;
    expect(changed).toMatchObject({
      phase: 'stopped',
      doors: 'open',
      active: false,
      stationCode: 'H14',
      generation: 1,
    });
    expect(() => reduceRun(changed, { type: 'set-speed', multiplier: 1.5 }, 20, lines)).toThrow(
      /Run speed/,
    );
    expect(() => createRunState(lines, { lineId: 'sakaisuji', stationCode: 'K21' })).toThrow(
      /Unknown station/,
    );
    expect(segmentPlanKey('yamanote', 'JY01', 'JY02', 'inner')).toBe('yamanote|JY01|JY02|inner');
  });

  it('atomically reconfigures line, direction and start station in one reset', () => {
    const initial = createRunState(lines, {
      lineId: 'yamanote',
      stationCode: 'JY18',
      direction: 'outer',
    });
    const changed = reduceRun(
      initial,
      { type: 'configure', lineId: 'sakaisuji', direction: 'northbound', stationCode: 'K20' },
      42,
      lines,
    );
    expect(changed.effects).toEqual([]);
    expect(changed.state).toMatchObject({
      lineId: 'sakaisuji',
      direction: 'northbound',
      stationCode: 'K20',
      phase: 'stopped',
      doors: 'open',
      active: false,
      incident: null,
      generation: initial.generation + 1,
      lastTickAt: 42,
    });
    expect(() =>
      reduceRun(
        initial,
        { type: 'configure', lineId: 'sakaisuji', direction: 'inner', stationCode: 'K11' },
        0,
        lines,
      ),
    ).toThrow(/Unknown direction/);
  });
});
