import { between, type Random } from './random';

const PARTIALS = 3;

export class Squeal {
  private readonly partials: OscillatorNode[];
  private readonly vibrato: OscillatorNode;
  private readonly depth: GainNode;
  private readonly level: GainNode;

  constructor(context: BaseAudioContext, output: AudioNode) {
    this.vibrato = context.createOscillator();
    this.vibrato.frequency.value = 5.5;
    this.depth = context.createGain();
    this.depth.gain.value = 18;
    this.level = context.createGain();
    this.level.gain.value = 0;
    this.vibrato.connect(this.depth);
    this.partials = Array.from({ length: PARTIALS }, () => {
      const partial = context.createOscillator();
      this.depth.connect(partial.frequency);
      partial.connect(this.level);
      return partial;
    });
    this.level.connect(output);
    for (const node of [this.vibrato, ...this.partials]) node.start();
  }

  retune(random: Random, low: number, high: number, when: number) {
    const base = between(random, low, high);
    this.partials.forEach((partial, index) => {
      partial.frequency.setValueAtTime(base * (1 + index * between(random, 0.48, 0.55)), when);
    });
    this.vibrato.frequency.setValueAtTime(between(random, 3.5, 7), when);
  }

  set(level: number, when: number, seconds: number) {
    this.level.gain.setTargetAtTime(level / PARTIALS, when, seconds);
  }

  dispose() {
    for (const node of [this.vibrato, ...this.partials]) {
      node.stop();
      node.disconnect();
    }
    this.depth.disconnect();
    this.level.disconnect();
  }
}
