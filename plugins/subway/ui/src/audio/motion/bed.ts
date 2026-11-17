import { between, createPicker, type Random } from './random';

const FADE_SECONDS = 3;
const SLOTS = 8;
const POINTS = 64;
// Equal-power crossfade: the two regions are uncorrelated recordings, so their powers add.
const RISE = Float32Array.from({ length: POINTS }, (_, i) =>
  Math.sin(((i / (POINTS - 1)) * Math.PI) / 2),
);
const FALL = RISE.slice().reverse();

export interface BedOptions {
  shortest?: number;
  longest?: number;
  /** Highest playback rate the bed will be driven at, so a region never runs off the buffer's end. */
  maxRate?: number;
}

/**
 * Plays a recording as an endless bed of random regions with crossfades, never the same region twice in a
 * row, so it has no audible period. Two regions are always scheduled: when one ends, the one after next is
 * queued, so it needs no timer. The caller owns the level; `stop` ends every region at a given time.
 */
export class BedShuffler {
  /** Each scheduled region with the time it is due to end. */
  private readonly live = new Map<AudioBufferSourceNode, number>();
  private readonly pick: () => number;
  private readonly shortest: number;
  private readonly longest: number;
  private readonly maxRate: number;
  private rate = 1;
  private nextAt = 0;
  private stopped = false;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly buffer: AudioBuffer,
    private readonly output: AudioNode,
    private readonly random: Random,
    options: BedOptions = {},
  ) {
    this.maxRate = options.maxRate ?? 1;
    const room = buffer.duration / this.maxRate - FADE_SECONDS;
    this.longest = Math.max(FADE_SECONDS, Math.min(options.longest ?? 25, room * 0.7));
    this.shortest = Math.min(options.shortest ?? 10, this.longest);
    this.pick = createPicker(SLOTS, random);
  }

  start(when: number) {
    this.nextAt = when;
    this.queue();
    this.queue();
  }

  setRate(rate: number, when: number) {
    this.rate = rate;
    for (const source of this.live.keys()) source.playbackRate.setTargetAtTime(rate, when, 0.1);
  }

  stop(when: number) {
    this.stopped = true;
    for (const [source, end] of this.live) source.stop(Math.min(when, end));
  }

  private queue() {
    if (this.stopped) return;
    const at = this.nextAt;
    const length = between(this.random, this.shortest, this.longest);
    const span = (length + FADE_SECONDS) * this.maxRate;
    const room = Math.max(0, this.buffer.duration - span);
    const offset = ((this.pick() + this.random()) / SLOTS) * room;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    gain.gain.value = 0;
    gain.gain.setValueCurveAtTime(RISE, at, FADE_SECONDS);
    gain.gain.setValueCurveAtTime(FALL, at + length, FADE_SECONDS);
    source.connect(gain).connect(this.output);
    source.onended = () => {
      this.live.delete(source);
      source.disconnect();
      gain.disconnect();
      this.queue();
    };
    source.start(at, offset);
    source.stop(at + length + FADE_SECONDS);
    this.live.set(source, at + length + FADE_SECONDS);
    this.nextAt = at + length;
  }
}
