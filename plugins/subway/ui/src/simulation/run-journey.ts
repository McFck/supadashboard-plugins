import type { SegmentCuePlan } from '../audio/sound-types';
import { stepStation, type LineDefinition } from './lines';
import { cueQueueEnd, doorPlan, EMPTY_CUE_PLAN } from './run-cues';
import { activeNow } from './run-motion';
import { segmentPlanKey, type SubwayCuePlans, type SubwayRunState } from './run-state';

export const RELEASE_MS = 600;
export const MIN_SEGMENT_SECONDS = { departure: 12, cruise: 5, approach: 12 } as const;

function travelDurationMs(plan: SegmentCuePlan, multiplier: number): number {
  const departure = Math.max(MIN_SEGMENT_SECONDS.departure, cueQueueEnd(plan.departure) + 2);
  const approach = Math.max(MIN_SEGMENT_SECONDS.approach, cueQueueEnd(plan.arrival) + 2);
  const cruise = Math.max(MIN_SEGMENT_SECONDS.cruise, 60 / multiplier - departure - approach);
  return (departure + cruise + approach) * 1000;
}

function routeSegments(
  line: LineDefinition,
  stationCode: string,
  direction: string,
  limit = Number.POSITIVE_INFINITY,
): Array<{ from: string; to: string }> {
  const result: Array<{ from: string; to: string }> = [];
  let current = stationCode;
  while (result.length < limit) {
    const next = stepStation(line, current, direction);
    if (!next) {
      break;
    }
    result.push({ from: current, to: next.code });
    current = next.code;
    if (line.loop && current === stationCode) {
      break;
    }
  }
  return result;
}

function stopBudgetMs(
  state: SubwayRunState,
  line: LineDefinition,
  from: string,
  to: string,
  direction: string,
  multiplier: number,
  plans: SubwayCuePlans,
  includeDwell: boolean,
): number {
  const plan = plans[segmentPlanKey(line.id, from, to, direction)] ?? EMPTY_CUE_PLAN;
  const close = doorPlan(plan, 'close');
  const open = doorPlan(plan, 'open');
  const dwell = includeDwell
    ? Math.max(state.dwellSeconds, cueQueueEnd(plan.preClose ?? [])) * 1000
    : 0;
  const closeAndRelease = Math.max(close.close_end ?? 0, close.end) * 1000 + RELEASE_MS;
  const opening = (open.open_end ?? open.end) * 1000;
  return dwell + closeAndRelease + travelDurationMs(plan, multiplier) + opening;
}

export function remainingJourneyMs(
  state: SubwayRunState,
  now: number,
  line: LineDefinition,
  plans: SubwayCuePlans,
): number {
  const at = activeNow(state, now);
  const timeline = state.incident?.resume ?? state;
  const timelineAt = state.incident ? state.incident.startedAt : at;
  let remaining = state.incident
    ? Math.max(0, state.incident.brakeMs - (at - state.incident.startedAt))
    : 0;

  if (timeline.segment) {
    const segment = timeline.segment;
    const plan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    const trainTime = travelDurationMs(plan, segment.multiplier);
    if (timeline.phase === 'arriving') {
      remaining += Math.max(0, (timeline.phaseDeadline ?? timelineAt) - timelineAt);
    } else if (timeline.phase === 'doorsClosing') {
      remaining += Math.max(0, (timeline.phaseDeadline ?? timelineAt) - timelineAt) + trainTime;
      const open = doorPlan(plan, 'open');
      remaining += (open.open_end ?? open.end) * 1000;
    } else {
      remaining += Math.max(0, trainTime - Math.max(0, timelineAt - segment.startedAt));
      const open = doorPlan(plan, 'open');
      remaining += (open.open_end ?? open.end) * 1000;
    }

    const remainingLoopStops = line.loop
      ? Math.max(0, state.loopArrivalsRemaining - (timeline.phase === 'arriving' ? 0 : 1))
      : Number.POSITIVE_INFINITY;
    for (const future of routeSegments(line, segment.to, segment.direction, remainingLoopStops)) {
      remaining += stopBudgetMs(
        state,
        line,
        future.from,
        future.to,
        segment.direction,
        state.nextMultiplier,
        plans,
        true,
      );
    }
    return remaining;
  }

  if (timeline.phase !== 'stopped' || !timeline.active) {
    return remaining;
  }
  // A loop line at the end of a lap is about to start the next one.
  const limit = line.loop
    ? state.loopArrivalsRemaining || line.stations.length
    : Number.POSITIVE_INFINITY;
  const future = routeSegments(line, timeline.stationCode, state.direction, limit);
  for (let index = 0; index < future.length; index++) {
    const segment = future[index];
    remaining += stopBudgetMs(
      state,
      line,
      segment.from,
      segment.to,
      state.direction,
      state.nextMultiplier,
      plans,
      index > 0,
    );
  }
  return remaining;
}
