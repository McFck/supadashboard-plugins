/**
 * Short scheduled sounds (wheel hits, releases, rattles, thumps). Every source is tracked until it ends, so a
 * snap or disposal silences everything still queued on the audio clock.
 */
export class OneShots {
  private readonly live = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly noise: AudioBuffer,
  ) {}

  private track(source: AudioBufferSourceNode, ...nodes: AudioNode[]) {
    this.live.add(source);
    source.onended = () => {
      this.live.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }

  sample(buffer: AudioBuffer, destination: AudioNode, when: number, gain: number, rate = 1) {
    const source = this.context.createBufferSource();
    const level = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    level.gain.value = gain;
    source.connect(level).connect(destination);
    this.track(source, level);
    source.start(when);
  }

  /** A low noise thump: the body settling at a stop, or the pressure wave at a tunnel portal. */
  thump(destination: AudioNode, when: number, gain: number, cutoff: number, seconds: number) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const level = this.context.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.frequency.value = cutoff;
    level.gain.value = 0;
    level.gain.setTargetAtTime(gain, when, seconds * 0.06);
    level.gain.setTargetAtTime(0, when + seconds * 0.2, seconds * 0.25);
    source.connect(filter).connect(level).connect(destination);
    this.track(source, filter, level);
    source.start(when, Math.random() * this.noise.duration);
    source.stop(when + seconds * 1.6);
  }

  cancel() {
    for (const source of this.live) source.stop();
  }
}
