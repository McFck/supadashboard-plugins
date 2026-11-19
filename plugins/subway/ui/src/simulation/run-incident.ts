import type { LineDefinition } from './lines';
import { advanceOne, copyTimeline, pushPhase, shiftedTimeline } from './run-advance';
import { scheduleCues, withDueCues } from './run-cues';
import { snapshotMotion } from './run-motion';
import {
  lineFor,
  segmentPlanKey,
  type IncidentKind,
  type RunEffect,
  type SubwayCuePlans,
  type SubwayRunState,
} from './run-state';

const BRAKE_MS = 2_000;

export function applyIncident(
  state: SubwayRunState,
  kind: IncidentKind,
  now: number,
  plans: SubwayCuePlans,
  effects: RunEffect[],
): SubwayRunState {
  if (state.incident) {
    return state;
  }
  const motion = snapshotMotion(state, now);
  const resume = copyTimeline(state);
  const doorsBefore = state.doors;
  const phase = kind === 'emergency' ? 'emergency' : 'suspended';
  pushPhase(effects, state, phase);
  if (kind === 'emergency') {
    effects.push({ type: 'emergency', generation: state.generation });
  } else {
    effects.push({ type: 'suspended', generation: state.generation });
  }
  const emergencyPlanKey =
    state.segment?.planKey ??
    segmentPlanKey(state.lineId, state.stationCode, state.stationCode, state.direction);
  const emergencyCues =
    kind === 'emergency'
      ? scheduleCues(plans[emergencyPlanKey]?.emergency ?? [], now, `${emergencyPlanKey}:emergency`)
      : [];
  const incidentState: SubwayRunState = {
    ...state,
    phase,
    doors: motion.speed === 0 && doorsBefore === 'open' ? 'open' : 'closed',
    phaseStartedAt: now,
    phaseDeadline: null,
    stopDeadline: null,
    pendingCues: emergencyCues,
    pausedAt: null,
    incident: {
      kind,
      startedAt: now,
      brakeMs: motion.speed > 0 ? BRAKE_MS : 0,
      speedAtStart: motion.speed,
      progressAtStart: motion.progress,
      doorsBefore,
      resume,
    },
  };
  return withDueCues(incidentState, now, effects);
}

export function resumeService(
  state: SubwayRunState,
  now: number,
  lines: readonly LineDefinition[],
  plans: SubwayCuePlans,
  effects: RunEffect[],
): SubwayRunState {
  if (!state.incident || state.incident.brakeMs > 0) {
    return state;
  }
  const incident = state.incident;
  const duration = Math.max(0, now - incident.startedAt);
  const timeline = shiftedTimeline(incident.resume, duration);
  let current: SubwayRunState = { ...state, ...timeline, incident: null, lastTickAt: now };
  const resumedSegment = incident.resume.segment;
  let resumedAtDestination = false;
  if (
    resumedSegment &&
    resumedSegment.departed &&
    ['departing', 'cruising', 'approaching'].includes(incident.resume.phase)
  ) {
    if (incident.progressAtStart >= 1) {
      const totalMs =
        resumedSegment.departureMs + resumedSegment.cruiseMs + resumedSegment.approachMs;
      current = {
        ...current,
        phase: 'approaching',
        doors: 'closed',
        phaseStartedAt: now,
        phaseDeadline: now,
        segment: { ...resumedSegment, startedAt: now - totalMs, baseProgress: 1 },
      };
      current = withDueCues(current, now, effects);
      current = advanceOne(current, now, lineFor(lines, current.lineId), plans, effects);
      resumedAtDestination = true;
    } else {
      current = {
        ...current,
        phase: 'departing',
        doors: 'closed',
        phaseStartedAt: now,
        phaseDeadline: now + resumedSegment.departureMs,
        segment: {
          ...resumedSegment,
          startedAt: now,
          baseProgress: incident.progressAtStart,
          departed: true,
        },
      };
    }
  }
  if (!resumedAtDestination) {
    pushPhase(effects, { ...current, phase: state.phase }, current.phase);
  }
  return { ...current, lastTickAt: now };
}
