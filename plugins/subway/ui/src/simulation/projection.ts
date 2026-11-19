import type { RunSnapshot } from './run';
import type { RunEffect } from './run-state';

export const projectionKeys = [
  'station',
  'next',
  'state',
  'line',
  'direction',
  'doorSide',
  'speed',
  'progress',
  'paused',
  'immersion',
] as const;
type ProjectionKey = (typeof projectionKeys)[number];

export function project(snapshot: RunSnapshot): Record<ProjectionKey, string | number | boolean> {
  return {
    station: snapshot.station,
    next: snapshot.next,
    state: snapshot.state,
    line: snapshot.line,
    direction: snapshot.direction,
    doorSide: snapshot.doorSide,
    speed: snapshot.speed,
    progress: snapshot.progress,
    paused: snapshot.paused,
    immersion: snapshot.immersion,
  };
}

export function discreteKey(snapshot: RunSnapshot): string {
  return [
    snapshot.station,
    snapshot.next,
    snapshot.state,
    snapshot.line,
    snapshot.direction,
    snapshot.doorSide,
    snapshot.doors,
    snapshot.paused,
    snapshot.immersion,
    snapshot.multiplier,
    snapshot.generation,
  ].join('|');
}

export function eventFor(effect: Exclude<RunEffect, { type: 'play-cue' }>): {
  id: string;
  parameter?: string;
  payload: unknown;
} {
  if (effect.type === 'departed') {
    return {
      id: 'subway.departed',
      parameter: effect.from,
      payload: {
        line: effect.line,
        direction: effect.direction,
        from: effect.from,
        to: effect.to,
        generation: effect.generation,
      },
    };
  }
  if (effect.type === 'arrived') {
    return {
      id: 'subway.arrived',
      parameter: effect.to,
      payload: {
        line: effect.line,
        direction: effect.direction,
        from: effect.from,
        to: effect.to,
        generation: effect.generation,
      },
    };
  }
  if (effect.type === 'state-changed') {
    return {
      id: 'subway.stateChanged',
      parameter: effect.state,
      payload: { generation: effect.generation },
    };
  }
  return {
    id: effect.type === 'emergency' ? 'subway.emergency' : 'subway.suspended',
    payload: { generation: effect.generation },
  };
}
