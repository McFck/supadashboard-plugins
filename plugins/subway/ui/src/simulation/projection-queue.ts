import type { AppletRuntimeContext, EventAncestry } from '@supadashboard/kit';
import { discreteKey, eventFor, project, projectionKeys } from './projection';
import type { RunSnapshot } from './run';
import type { RunEffect } from './run-state';

/** In ms. */
const NUMERIC_INTERVAL_MS = 250;

type CueEffect = Extract<RunEffect, { type: 'play-cue' }>;

export interface ProjectionBatch {
  generation: number;
  settled: boolean;
  effects: readonly RunEffect[];
  ancestry?: EventAncestry;
  now(): number;
  snapshot(now: number): RunSnapshot;
  current(generation: number): boolean;
  playCue(effect: CueEffect): void;
}

/** Batches run one after another so their writes never interleave; each stops once it is no longer current. */
export class ProjectionQueue {
  private chain = Promise.resolve();
  private lastDiscrete = '';
  private lastNumericAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly context: AppletRuntimeContext) {}

  unavailable(current: () => boolean): void {
    this.enqueue(async () => {
      for (const [key, value] of [
        ['state', 'unavailable'],
        ['paused', true],
      ] as const) {
        if (!current()) {
          return;
        }
        if (!Object.is(this.context.getState(key), value)) {
          await this.context.setState(key, value);
        }
      }
    });
  }

  write(batch: ProjectionBatch): void {
    this.enqueue(async () => {
      if (!batch.current(batch.generation)) {
        return;
      }
      const now = batch.now();
      const snapshot = batch.snapshot(now);
      const discrete = discreteKey(snapshot);
      if (
        batch.settled ||
        discrete !== this.lastDiscrete ||
        now - this.lastNumericAt >= NUMERIC_INTERVAL_MS
      ) {
        this.lastDiscrete = discrete;
        this.lastNumericAt = now;
        const values = project(snapshot);
        for (const key of projectionKeys) {
          if (!batch.current(batch.generation)) {
            return;
          }
          if (!Object.is(this.context.getState(key), values[key])) {
            await this.context.setState(key, values[key]);
          }
        }
      }
      for (const effect of batch.effects) {
        if (!batch.current(effect.generation)) {
          return;
        }
        if (effect.type === 'play-cue') {
          batch.playCue(effect);
          continue;
        }
        const event = eventFor(effect);
        await this.context.emitEvent(event.id, event.parameter, event.payload, batch.ancestry);
      }
    });
  }

  private enqueue(step: () => Promise<void>): void {
    // A failed write must not block later batches; the next batch writes the state again.
    this.chain = this.chain
      .then(step)
      .catch((error: unknown) => console.warn('Subway state projection failed', error));
  }
}
