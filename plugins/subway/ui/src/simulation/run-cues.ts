import type { DoorSequencePlan, ResolvedCue, SegmentCuePlan, TimedCue } from '../audio/sound-types';
import type { RunEffect, ScheduledCue, SubwayRunState } from './run-state';

const EMPTY_DOOR_PLAN: DoorSequencePlan = Object.freeze({ events: [], end: 0 });
export const EMPTY_CUE_PLAN: SegmentCuePlan = Object.freeze({
  close: EMPTY_DOOR_PLAN,
  open: EMPTY_DOOR_PLAN,
  departure: [],
  arrival: [],
});

export function doorPlan(plan: SegmentCuePlan, kind: 'open' | 'close'): DoorSequencePlan {
  return plan?.[kind] ?? EMPTY_DOOR_PLAN;
}

function validateCue(cue: ResolvedCue, part: string): void {
  if (
    !cue ||
    !Number.isFinite(cue.duration) ||
    cue.duration <= 0 ||
    !Number.isFinite(cue.audible_end) ||
    cue.audible_end < 0 ||
    cue.audible_end > cue.duration
  ) {
    throw new Error(`Invalid Subway ${part} cue`);
  }
}

export function scheduleCues(
  items: readonly TimedCue[],
  start: number,
  idPrefix: string,
): ScheduledCue[] {
  return items
    .map((item, index) => {
      if (!Number.isFinite(item.at) || item.at < 0) {
        throw new Error(`Invalid Subway cue time: ${item.part}`);
      }
      validateCue(item.cue, item.part);
      return { ...item, id: `${idPrefix}:${index}:${item.cue.file}`, at: start + item.at * 1000 };
    })
    .sort((a, b) => a.at - b.at);
}

export function cueQueueEnd(items: readonly TimedCue[]): number {
  return items.reduce((end, item) => {
    validateCue(item.cue, item.part);
    if (!Number.isFinite(item.at) || item.at < 0) {
      throw new Error(`Invalid Subway cue time: ${item.part}`);
    }
    return Math.max(end, item.at + item.cue.duration);
  }, 0);
}

export function validateDoorPlan(plan: DoorSequencePlan, action: string): void {
  if (!plan || !Number.isFinite(plan.end) || plan.end < 0) {
    throw new Error(`Invalid Subway ${action} plan`);
  }
  for (const event of plan.events) {
    if (!Number.isFinite(event.at) || event.at < 0) {
      throw new Error(`Invalid Subway ${action} cue time`);
    }
    validateCue(event.cue, event.part);
  }
  for (const value of [plan.open_end, plan.close_end, plan.departure_melody_end]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Invalid Subway ${action} anchor`);
    }
  }
}

export function withDueCues(
  state: SubwayRunState,
  now: number,
  effects: RunEffect[],
): SubwayRunState {
  if (
    (state.incident && state.phase !== 'emergency') ||
    state.pausedAt !== null ||
    !state.pendingCues.length
  ) {
    return state;
  }
  const due = state.pendingCues.filter((cue) => cue.at <= now);
  if (!due.length) {
    return state;
  }
  effects.push(
    ...due.map((item) => ({
      type: 'play-cue' as const,
      id: item.id,
      cue: item.cue,
      generation: state.generation,
    })),
  );
  return { ...state, pendingCues: state.pendingCues.filter((cue) => cue.at > now) };
}
