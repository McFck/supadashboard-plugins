import type { ResolvedCue, SegmentCuePlan, TimedCue } from '../audio/sound-types';
import type { LineDefinition } from './lines';

export type RunPhase =
  | 'stopped'
  | 'doorsClosing'
  | 'departing'
  | 'cruising'
  | 'approaching'
  | 'arriving'
  | 'emergency'
  | 'suspended';
export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing';
export type IncidentKind = 'emergency' | 'suspended';

export type SubwayCuePlans = Readonly<Record<string, SegmentCuePlan>>;

export interface RunSegment {
  from: string;
  to: string;
  direction: string;
  planKey: string;
  multiplier: number;
  startedAt: number;
  departureMs: number;
  cruiseMs: number;
  approachMs: number;
  baseProgress: number;
  departed: boolean;
}

export interface ScheduledCue extends TimedCue {
  at: number;
  id: string;
}

export interface RunTimeline {
  phase: RunPhase;
  doors: DoorPhase;
  active: boolean;
  stationCode: string;
  phaseStartedAt: number | null;
  phaseDeadline: number | null;
  stopDeadline: number | null;
  segment: RunSegment | null;
  pendingCues: readonly ScheduledCue[];
  loopArrivalsRemaining: number;
  /** Completed laps (loop line) and terminus turn-backs (other lines) since the run started. */
  laps: number;
}

export interface RunIncident {
  kind: IncidentKind;
  startedAt: number;
  brakeMs: number;
  speedAtStart: number;
  progressAtStart: number;
  doorsBefore: DoorPhase;
  resume: RunTimeline;
}

export interface SubwayRunState extends RunTimeline {
  lineId: LineDefinition['id'];
  direction: string;
  multiplier: number;
  nextMultiplier: number;
  dwellSeconds: number;
  generation: number;
  immersion: boolean;
  pausedAt: number | null;
  lastTickAt: number;
  incident: RunIncident | null;
}

export type RunCommand =
  | { type: 'start' }
  | { type: 'configure'; lineId: LineDefinition['id']; direction: string; stationCode: string }
  | { type: 'set-speed'; multiplier: number }
  | { type: 'set-immersion'; enabled: boolean }
  | { type: 'emergency' }
  | { type: 'suspend' }
  | { type: 'resume-service' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'tick' };

export type RunEffect =
  | { type: 'play-cue'; id: string; cue: ResolvedCue; generation: number }
  | {
      type: 'departed';
      from: string;
      to: string;
      line: string;
      direction: string;
      generation: number;
    }
  | {
      type: 'arrived';
      from: string;
      to: string;
      line: string;
      direction: string;
      generation: number;
    }
  | { type: 'state-changed'; state: RunPhase; generation: number }
  | { type: 'emergency'; generation: number }
  | { type: 'suspended'; generation: number };

export interface RunTransition {
  state: SubwayRunState;
  effects: readonly RunEffect[];
}

export function segmentPlanKey(
  lineId: string,
  from: string,
  to: string,
  direction: string,
): string {
  return `${lineId}|${from}|${to}|${direction}`;
}

export function lineFor(lines: readonly LineDefinition[], id: string): LineDefinition {
  const line = lines.find((item) => item.id === id);
  if (!line) throw new Error(`Unknown Subway line: ${id}`);
  return line;
}

export function finiteTime(now: number): void {
  if (!Number.isFinite(now)) throw new Error('Subway clock must return a finite time');
}
