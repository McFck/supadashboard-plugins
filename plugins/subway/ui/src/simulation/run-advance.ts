import { stepStation, type LineDefinition } from './lines';
import {
  cueQueueEnd,
  doorPlan,
  EMPTY_CUE_PLAN,
  scheduleCues,
  validateDoorPlan,
  withDueCues,
} from './run-cues';
import { MIN_SEGMENT_SECONDS, RELEASE_MS } from './run-journey';
import {
  lineFor,
  segmentPlanKey,
  type RunEffect,
  type RunPhase,
  type RunSegment,
  type RunTimeline,
  type SubwayCuePlans,
  type SubwayRunState,
} from './run-state';
import { snapshotMotion } from './run-motion';

const MAX_GAP_MS = 5_000;
const MAX_CATCH_UP_PASSES = 1_000;

export function pushPhase(effects: RunEffect[], state: SubwayRunState, phase: RunPhase): void {
  if (state.phase !== phase) {
    effects.push({ type: 'state-changed', state: phase, generation: state.generation });
  }
}

export function copyTimeline(state: SubwayRunState): RunTimeline {
  return {
    phase: state.phase,
    doors: state.doors,
    active: state.active,
    stationCode: state.stationCode,
    phaseStartedAt: state.phaseStartedAt,
    phaseDeadline: state.phaseDeadline,
    stopDeadline: state.stopDeadline,
    segment: state.segment ? { ...state.segment } : null,
    pendingCues: [...state.pendingCues],
    loopArrivalsRemaining: state.loopArrivalsRemaining,
    laps: state.laps,
  };
}

function installTimeline(state: SubwayRunState, timeline: RunTimeline): SubwayRunState {
  return {
    ...state,
    ...timeline,
    segment: timeline.segment ? { ...timeline.segment } : null,
    pendingCues: [...timeline.pendingCues],
  };
}

export function shiftedTimeline(timeline: RunTimeline, delta: number): RunTimeline {
  return {
    ...timeline,
    phaseStartedAt: timeline.phaseStartedAt === null ? null : timeline.phaseStartedAt + delta,
    phaseDeadline: timeline.phaseDeadline === null ? null : timeline.phaseDeadline + delta,
    stopDeadline: timeline.stopDeadline === null ? null : timeline.stopDeadline + delta,
    segment: timeline.segment
      ? { ...timeline.segment, startedAt: timeline.segment.startedAt + delta }
      : null,
    pendingCues: timeline.pendingCues.map((cue) => ({ ...cue, at: cue.at + delta })),
  };
}

export function shiftStateTimes(state: SubwayRunState, delta: number): SubwayRunState {
  return installTimeline(state, shiftedTimeline(state, delta));
}

export function prepareDwell(
  state: SubwayRunState,
  at: number,
  line: LineDefinition,
  plans: SubwayCuePlans,
): Pick<SubwayRunState, 'stopDeadline' | 'pendingCues'> {
  const target = stepStation(line, state.stationCode, state.direction);
  if (!state.active || !target) {
    return { stopDeadline: null, pendingCues: [] };
  }
  const planKey = segmentPlanKey(line.id, state.stationCode, target.code, state.direction);
  const preClose = (plans[planKey] ?? EMPTY_CUE_PLAN).preClose ?? [];
  const queued = scheduleCues(preClose, at, `${planKey}:pre-close`);
  return {
    stopDeadline: at + Math.max(state.dwellSeconds, cueQueueEnd(preClose)) * 1000,
    pendingCues: [...state.pendingCues.filter((cue) => cue.at <= at), ...queued].sort(
      (a, b) => a.at - b.at,
    ),
  };
}

function startClosing(
  state: SubwayRunState,
  at: number,
  line: LineDefinition,
  plans: SubwayCuePlans,
  effects: RunEffect[],
): SubwayRunState {
  const target = stepStation(line, state.stationCode, state.direction);
  if (!target) {
    return { ...state, active: false, stopDeadline: null, phaseDeadline: null };
  }
  const planKey = segmentPlanKey(line.id, state.stationCode, target.code, state.direction);
  const cuePlan = plans[planKey] ?? EMPTY_CUE_PLAN;
  validateDoorPlan(doorPlan(cuePlan, 'close'), 'close');
  validateDoorPlan(doorPlan(cuePlan, 'open'), 'open');
  const close = doorPlan(cuePlan, 'close');
  const closeMs = Math.max(close.close_end ?? 0, close.end) * 1000;
  const segment: RunSegment = {
    from: state.stationCode,
    to: target.code,
    direction: state.direction,
    planKey,
    multiplier: state.nextMultiplier,
    startedAt: at + closeMs + RELEASE_MS,
    departureMs: 0,
    cruiseMs: 0,
    approachMs: 0,
    baseProgress: 0,
    departed: false,
  };
  const departureSeconds = Math.max(
    MIN_SEGMENT_SECONDS.departure,
    cueQueueEnd(cuePlan.departure) + 2,
  );
  const approachSeconds = Math.max(MIN_SEGMENT_SECONDS.approach, cueQueueEnd(cuePlan.arrival) + 2);
  const baseSeconds = 60 / segment.multiplier;
  const cruiseSeconds = Math.max(
    MIN_SEGMENT_SECONDS.cruise,
    baseSeconds - departureSeconds - approachSeconds,
  );
  segment.departureMs = departureSeconds * 1000;
  segment.cruiseMs = cruiseSeconds * 1000;
  segment.approachMs = approachSeconds * 1000;
  const closeCues = scheduleCues(close.events, at, `${planKey}:close`);
  pushPhase(effects, state, 'doorsClosing');
  return {
    ...state,
    phase: 'doorsClosing',
    doors: 'closing',
    active: true,
    stopDeadline: null,
    phaseStartedAt: at,
    phaseDeadline: at + Math.max(closeMs, close.end * 1000) + RELEASE_MS,
    segment,
    pendingCues: [...state.pendingCues, ...closeCues].sort((a, b) => a.at - b.at),
    // A loop line starts its next lap when it leaves the station that completed the last one.
    ...(line.loop && state.loopArrivalsRemaining <= 0
      ? { loopArrivalsRemaining: line.stations.length, laps: state.laps + 1 }
      : {}),
  };
}

export function advanceOne(
  state: SubwayRunState,
  at: number,
  line: LineDefinition,
  plans: SubwayCuePlans,
  effects: RunEffect[],
): SubwayRunState {
  const phase = state.phase;
  if (phase === 'stopped') {
    if (!state.active || state.stopDeadline === null) {
      return state;
    }
    return startClosing({ ...state, stopDeadline: null }, at, line, plans, effects);
  }
  if (phase === 'doorsClosing') {
    const segment = state.segment;
    if (!segment) {
      return { ...state, active: false, phase: 'stopped', doors: 'open', phaseDeadline: null };
    }
    const cuePlan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    const nextSegment = { ...segment, startedAt: at, departed: true };
    pushPhase(effects, state, 'departing');
    effects.push({
      type: 'departed',
      from: segment.from,
      to: segment.to,
      line: line.id,
      direction: segment.direction,
      generation: state.generation,
    });
    return {
      ...state,
      phase: 'departing',
      doors: 'closed',
      phaseStartedAt: at,
      phaseDeadline: at + segment.departureMs,
      segment: nextSegment,
      pendingCues: [
        ...state.pendingCues,
        ...scheduleCues(cuePlan.departure, at, `${segment.planKey}:departure`),
      ].sort((a, b) => a.at - b.at),
    };
  }
  if (phase === 'departing') {
    const segment = state.segment;
    if (!segment) {
      return state;
    }
    pushPhase(effects, state, 'cruising');
    return {
      ...state,
      phase: 'cruising',
      doors: 'closed',
      phaseStartedAt: at,
      phaseDeadline: at + segment.cruiseMs,
    };
  }
  if (phase === 'cruising') {
    const segment = state.segment;
    if (!segment) {
      return state;
    }
    const cuePlan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    pushPhase(effects, state, 'approaching');
    return {
      ...state,
      phase: 'approaching',
      doors: 'closed',
      phaseStartedAt: at,
      phaseDeadline: at + segment.approachMs,
      pendingCues: [
        ...state.pendingCues,
        ...scheduleCues(cuePlan.arrival, at, `${segment.planKey}:arrival`),
      ].sort((a, b) => a.at - b.at),
    };
  }
  if (phase === 'approaching') {
    const segment = state.segment;
    if (!segment) {
      return state;
    }
    const cuePlan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    const open = doorPlan(cuePlan, 'open');
    const openEnd = (open.open_end ?? open.end) * 1000;
    pushPhase(effects, state, 'arriving');
    effects.push({
      type: 'arrived',
      from: segment.from,
      to: segment.to,
      line: line.id,
      direction: segment.direction,
      generation: state.generation,
    });
    return {
      ...state,
      phase: 'arriving',
      doors: 'opening',
      stationCode: segment.to,
      phaseStartedAt: at,
      phaseDeadline: at + openEnd,
      pendingCues: scheduleCues(open.events, at, `${segment.planKey}:open`),
      loopArrivalsRemaining: line.loop ? Math.max(0, state.loopArrivalsRemaining - 1) : 0,
    };
  }
  if (phase === 'arriving') {
    // Service never ends: at a terminus the train turns back and runs the line the other way.
    const terminus = !stepStation(line, state.stationCode, state.direction);
    const direction = terminus
      ? (line.directions.find((item) => item.id !== state.direction)?.id ?? state.direction)
      : state.direction;
    pushPhase(effects, state, 'stopped');
    const stopped: SubwayRunState = {
      ...state,
      direction,
      laps: terminus ? state.laps + 1 : state.laps,
      phase: 'stopped',
      doors: 'open',
      active: !!stepStation(line, state.stationCode, direction),
      phaseStartedAt: at,
      phaseDeadline: null,
      stopDeadline: null,
      segment: null,
      pendingCues: [],
    };
    return { ...stopped, ...prepareDwell(stopped, at, line, plans) };
  }
  return state;
}

export function dueDeadline(state: SubwayRunState): number | null {
  if (state.phase === 'stopped' && state.active) {
    return state.stopDeadline;
  }
  if (
    state.phaseDeadline !== null &&
    ['doorsClosing', 'departing', 'cruising', 'approaching', 'arriving'].includes(state.phase)
  ) {
    return state.phaseDeadline;
  }
  if (state.incident && state.incident.brakeMs > 0 && state.phaseStartedAt !== null) {
    return state.incident.startedAt + state.incident.brakeMs;
  }
  return null;
}

export function advance(
  state: SubwayRunState,
  now: number,
  lines: readonly LineDefinition[],
  plans: SubwayCuePlans,
  effects: RunEffect[],
): SubwayRunState {
  let current = state;
  if (current.pausedAt !== null) {
    return current;
  }
  const pollingPhase =
    ['departing', 'cruising', 'approaching'].includes(current.phase) || !!current.incident?.brakeMs;
  if (pollingPhase && now - current.lastTickAt > MAX_GAP_MS) {
    const gap = now - current.lastTickAt;
    current = shiftStateTimes(current, gap);
    if (current.incident) {
      current = {
        ...current,
        incident: { ...current.incident, startedAt: current.incident.startedAt + gap },
      };
    }
    return { ...current, lastTickAt: now };
  }
  current = { ...current, lastTickAt: now };
  if (current.incident) {
    const incident = current.incident;
    current = withDueCues(current, now, effects);
    if (incident.brakeMs > 0 && now >= incident.startedAt + incident.brakeMs) {
      const heldMotion = snapshotMotion(current, now);
      const held = {
        ...incident,
        speedAtStart: 0,
        brakeMs: 0,
        progressAtStart: heldMotion.progress,
      };
      return { ...current, incident: held, phaseStartedAt: now, lastTickAt: now };
    }
    return current;
  }
  current = withDueCues(current, now, effects);
  const line = lineFor(lines, current.lineId);
  for (let transitions = 0; transitions < 8; transitions++) {
    const deadline = dueDeadline(current);
    if (deadline === null || deadline > now) {
      break;
    }
    const at = deadline;
    current = withDueCues(current, at, effects);
    current = advanceOne(current, at, line, plans, effects);
  }
  return current;
}

/** Replays every deadline up to `now`, as if the run had never paused. Cues and events that fell due
 * meanwhile are history, so they are dropped instead of played or emitted in a burst. */
export function catchUp(
  state: SubwayRunState,
  now: number,
  lines: readonly LineDefinition[],
  plans: SubwayCuePlans,
): SubwayRunState {
  let current: SubwayRunState = { ...state, pausedAt: null };
  for (let pass = 0; pass < MAX_CATCH_UP_PASSES; pass++) {
    // lastTickAt = now skips the long-gap freeze in `advance`; the gap here is meant to be replayed.
    current = advance({ ...current, lastTickAt: now }, now, lines, plans, []);
    const deadline = dueDeadline(current);
    if (deadline === null || deadline > now) {
      break;
    }
  }
  return current;
}
