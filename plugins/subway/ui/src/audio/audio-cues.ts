import type { RunEffect } from '../simulation/run-state';
import { playEmergencyAlert } from './audio-alert';
import { createCueBufferCache } from './audio-cache';
import { effectGain } from './audio-level';
import { playCueSource } from './cue-source';
import type { ResolvedCue } from './sound-types';

/** The context and the two buses cues play through; voices sit on their own bus under the cue bus. */
export interface AudioGraph {
  context: AudioContext;
  cueBus: GainNode;
  voiceBus: GainNode;
}

export interface CuePlayerHost {
  fetch: typeof fetch;
  graph(): AudioGraph | undefined;
  disposed(): boolean;
  warnOnce(key: string, error: unknown): void;
  /** A voice starts: the train sound ducks under it. */
  duck(when: number, seconds: number): void;
}

type CueEffect = Extract<RunEffect, { type: 'play-cue' }>;

/** Decodes and plays the run's recorded cues and its synthetic alert; one `stop()` silences all of them. */
export class CuePlayer {
  private readonly sources = new Map<AudioScheduledSourceNode, string | undefined>();
  private readonly buffers;
  /** The run generation whose emergency alert already sounded; generations only grow. */
  private alerted = -1;

  constructor(private readonly host: CuePlayerHost) {
    this.buffers = createCueBufferCache({
      fetch: host.fetch,
      context: () => host.graph()?.context,
      disposed: host.disposed,
      warnOnce: host.warnOnce,
    });
  }

  preload(cues: readonly ResolvedCue[]): void {
    for (const cue of cues) {
      void this.buffers.decode(cue);
    }
  }

  /** Plays `effect` once decoded, skipping what elapsed meanwhile, unless `current()` turned false. */
  async play(effect: CueEffect, current: () => boolean): Promise<void> {
    const graph = this.host.graph();
    if (!graph) {
      return;
    }
    const { context } = graph;
    const scheduledAt = context.currentTime;
    const buffer = await this.buffers.decode(effect.cue);
    if (!buffer || this.host.disposed() || !current() || this.host.graph() !== graph) {
      return;
    }
    const elapsed = Math.max(0, context.currentTime - scheduledAt);
    if (elapsed >= effect.cue.duration) {
      return;
    }
    const { role, offset, duration, gain } = effect.cue;
    const cue: ResolvedCue = {
      ...effect.cue,
      gain:
        role === 'voice'
          ? gain
          : effectGain(buffer, offset, duration, gain) * 10 ** ((effect.cue.trimDb ?? 0) / 20),
      offset: offset + elapsed,
      duration: duration - elapsed,
    };
    const voice = cue.role === 'voice';
    try {
      const now = context.currentTime;
      const source = playCueSource(
        context,
        voice ? graph.voiceBus : graph.cueBus,
        buffer,
        cue,
        now,
      );
      if (voice) {
        this.host.duck(now, cue.duration);
      }
      this.sources.set(source, cue.url);
      this.buffers.pin(cue.url, 1);
      source.addEventListener(
        'ended',
        () => {
          this.sources.delete(source);
          this.buffers.pin(cue.url, -1);
          source.disconnect();
          this.buffers.prune();
        },
        { once: true },
      );
    } catch (error) {
      this.host.warnOnce(`play:${cue.url}`, error);
    }
  }

  /** Sounds the emergency alert of `generation` once, after silencing every cue. */
  alert(generation: number, muted: boolean): void {
    if (this.alerted === generation) {
      return;
    }
    this.stop();
    const graph = this.host.graph();
    if (!graph || muted) {
      return;
    }
    this.alerted = generation;
    playEmergencyAlert(graph.context, graph.cueBus, this.sources);
  }

  stop(): void {
    for (const [source, url] of [...this.sources]) {
      try {
        source.stop();
      } catch {
        // The source already ended; stopping it again is the only failure and is harmless.
      }
      source.disconnect();
      this.sources.delete(source);
      this.buffers.pin(url, -1);
    }
  }

  /** Drops the decoded buffers; they belong to a context that is closing. */
  clear(): void {
    this.buffers.clear();
  }
}
