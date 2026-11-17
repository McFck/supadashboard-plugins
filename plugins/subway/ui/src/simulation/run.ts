import { stepStation, type LineDefinition } from './lines';
import { advance, catchUp, dueDeadline, prepareDwell } from './run-advance';
import { applyIncident, resumeService } from './run-incident';
import { remainingJourneyMs } from './run-journey';
import { activeNow, clamp, cruisePower, snapshotMotion } from './run-motion';
import {
  finiteTime,
  lineFor,
  type DoorPhase,
  type RunCommand,
  type RunEffect,
  type RunPhase,
  type RunTransition,
  type SubwayCuePlans,
  type SubwayRunState,
} from './run-state';

export interface RunSnapshot {
  /** True before the first departure, distinct from a later visit to the same stop. */
  initialStop?: boolean;
  /** Actual departure + cruise budget, so the LCD cycle also fits a shortened simulation. */
  screenRunDurationMs?: number;
  station: string;
  next: string;
  state: RunPhase;
  line: string;
  direction: string;
  doorSide: 'left' | 'right' | 'both' | 'unknown';
  doors: DoorPhase;
  speed: number;
  power: number;
  brake: number;
  progress: number;
  paused: boolean;
  immersion: boolean;
  generation: number;
  multiplier: number;
  remainingMinutes: number;
}

export function createRunState(
  lines: readonly LineDefinition[],
  options: {
    lineId?: LineDefinition['id'];
    stationCode?: string;
    direction?: string;
    multiplier?: number;
    dwellSeconds?: number;
    immersion?: boolean;
    now?: number;
  } = {},
): SubwayRunState {
  const now = options.now ?? 0;
  finiteTime(now);
  const line = lineFor(lines, options.lineId ?? 'yamanote');
  const stationCode = options.stationCode ?? line.stations[0]?.code;
  if (!stationCode || !line.stations.some((station) => station.code === stationCode))
    throw new Error(`Unknown station for ${line.id}: ${stationCode}`);
  const direction = options.direction ?? line.directions[0]?.id;
  if (!direction || !line.directions.some((item) => item.id === direction))
    throw new Error(`Unknown direction for ${line.id}: ${direction}`);
  const multiplier = options.multiplier ?? 1;
  if (![0.5, 1, 2].includes(multiplier)) throw new Error('Run speed must be 0.5, 1, or 2');
  const dwellSeconds = options.dwellSeconds ?? 15;
  if (!Number.isFinite(dwellSeconds) || dwellSeconds < 0)
    throw new Error('Dwell must be a non-negative finite duration');
  return {
    lineId: line.id,
    direction,
    multiplier,
    nextMultiplier: multiplier,
    dwellSeconds,
    phase: 'stopped',
    doors: 'open',
    active: false,
    stationCode,
    phaseStartedAt: null,
    phaseDeadline: null,
    stopDeadline: null,
    segment: null,
    pendingCues: [],
    loopArrivalsRemaining: line.loop ? line.stations.length : 0,
    laps: 0,
    generation: 0,
    immersion: options.immersion ?? true,
    pausedAt: null,
    lastTickAt: now,
    incident: null,
  };
}

export function reduceRun(
  state: SubwayRunState,
  command: RunCommand,
  now: number,
  lines: readonly LineDefinition[],
  plans: SubwayCuePlans = {},
): RunTransition {
  finiteTime(now);
  const effects: RunEffect[] = [];
  let current = state;
  if (command.type === 'tick')
    return { state: advance(current, now, lines, plans, effects), effects };
  if (command.type === 'pause') {
    if (current.pausedAt !== null) return { state: current, effects };
    current = advance(current, now, lines, plans, effects);
    return { state: { ...current, pausedAt: now, lastTickAt: now }, effects };
  }
  if (command.type === 'resume') {
    if (current.pausedAt === null) return { state: current, effects };
    return { state: catchUp(current, now, lines, plans), effects };
  }
  if (command.type === 'emergency' || command.type === 'suspend') {
    current = advance(current, now, lines, plans, effects);
    return {
      state: applyIncident(
        current,
        command.type === 'emergency' ? 'emergency' : 'suspended',
        now,
        plans,
        effects,
      ),
      effects,
    };
  }
  if (command.type === 'resume-service')
    return { state: resumeService(current, now, lines, plans, effects), effects };
  if (command.type === 'set-immersion')
    return { state: { ...current, immersion: command.enabled }, effects };
  if (command.type === 'configure') {
    const line = lineFor(lines, command.lineId);
    if (!line.directions.some((item) => item.id === command.direction))
      throw new Error(`Unknown direction for ${line.id}: ${command.direction}`);
    if (!line.stations.some((item) => item.code === command.stationCode))
      throw new Error(`Unknown station for ${line.id}: ${command.stationCode}`);
    current = {
      ...current,
      lineId: line.id,
      direction: command.direction,
      stationCode: command.stationCode,
      phase: 'stopped',
      doors: 'open',
      active: false,
      phaseStartedAt: null,
      phaseDeadline: null,
      stopDeadline: null,
      segment: null,
      pendingCues: [],
      loopArrivalsRemaining: line.loop ? line.stations.length : 0,
      incident: null,
      pausedAt: null,
      generation: current.generation + 1,
      lastTickAt: now,
    };
    return { state: current, effects };
  }
  if (command.type === 'set-speed') {
    if (![0.5, 1, 2].includes(command.multiplier))
      throw new Error('Run speed must be 0.5, 1, or 2');
    return { state: { ...current, nextMultiplier: command.multiplier }, effects };
  }
  if (command.type === 'start') {
    const line = lineFor(lines, current.lineId);
    if (
      current.phase !== 'stopped' ||
      current.incident ||
      current.active ||
      !stepStation(line, current.stationCode, current.direction)
    )
      return { state: current, effects };
    const started = {
      ...current,
      active: true,
      generation: current.generation + 1,
      lastTickAt: now,
    };
    return {
      state: { ...started, ...prepareDwell(started, now, lineFor(lines, started.lineId), plans) },
      effects,
    };
  }
  return { state: current, effects };
}

export function snapshotRun(
  state: SubwayRunState,
  now: number,
  lines: readonly LineDefinition[],
  plans: SubwayCuePlans = {},
): RunSnapshot {
  finiteTime(now);
  const line = lineFor(lines, state.lineId);
  const at = activeNow(state, now);
  const motion = snapshotMotion(state, at);
  const station = line.stations.find((item) => item.code === state.stationCode)!;
  const side = station.doorByDirection[state.direction]?.side ?? 'unknown';
  const hasCommittedArrival =
    state.phase === 'arriving' || state.incident?.resume.phase === 'arriving';
  const next = hasCommittedArrival
    ? ((state.active ? stepStation(line, state.stationCode, state.direction)?.code : '') ?? '')
    : (state.segment?.to ??
      (state.phase === 'stopped' && state.active
        ? stepStation(line, state.stationCode, state.direction)?.code
        : '') ??
      '');
  const braking = !!state.incident;
  const power = braking
    ? 0
    : state.phase === 'departing'
      ? 1
      : state.phase === 'cruising' && state.segment
        ? cruisePower(state.segment, at)
        : 0;
  const brake =
    braking ||
    state.phase === 'stopped' ||
    state.phase === 'arriving' ||
    (state.phase === 'doorsClosing' && state.segment !== null && at < state.segment.startedAt)
      ? 1
      : state.phase === 'approaching'
        ? 0.35
        : 0;
  const remaining = remainingJourneyMs(state, at, line, plans);
  return {
    station: state.stationCode,
    next,
    state: state.phase,
    line: line.id,
    direction: state.segment?.direction ?? state.direction,
    initialStop: !state.segment && state.loopArrivalsRemaining === line.stations.length,
    screenRunDurationMs: state.segment
      ? state.segment.departureMs + state.segment.cruiseMs
      : undefined,
    doorSide: side,
    doors: state.doors,
    speed: clamp(motion.speed, 0, 60),
    power,
    brake,
    progress: clamp(motion.progress, 0, 1),
    paused: state.pausedAt !== null,
    immersion: state.immersion,
    generation: state.generation,
    multiplier: state.nextMultiplier,
    remainingMinutes: Math.ceil(Math.max(0, remaining) / 60_000),
  };
}

export function nextRunWake(state: SubwayRunState, now: number): number | null {
  if (state.pausedAt !== null) return null;
  if (state.incident) {
    const cueDeadline = state.pendingCues[0]?.at ?? Number.POSITIVE_INFINITY;
    const brakeDeadline =
      state.incident.brakeMs > 0
        ? Math.min(now + 50, state.incident.startedAt + state.incident.brakeMs)
        : Number.POSITIVE_INFINITY;
    const wakeAt = Math.min(cueDeadline, brakeDeadline);
    return Number.isFinite(wakeAt) ? wakeAt : null;
  }
  if (['departing', 'cruising', 'approaching'].includes(state.phase))
    return Math.min(now + 50, state.phaseDeadline ?? now + 50);
  return dueDeadline(state);
}
