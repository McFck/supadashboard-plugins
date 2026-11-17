import type { MotorProfile } from './manifest';
import { clamp, curve, fromDb, type Effort } from './levels';

type BveProfile = Extract<MotorProfile, { kind: 'bve' }>;

// Most BVE loops are cut to wrap seamlessly; crossfading those smears phase and dips the level each repeat.
function seamless(buffer: AudioBuffer) {
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let step = 0;
    for (let i = 1; i < data.length; i++) step += Math.abs(data[i] - data[i - 1]);
    if (Math.abs(data[0] - data[data.length - 1]) > (4 * step) / (data.length - 1) + 1e-4)
      return false;
  }
  return true;
}

/** A loop with a jump at its wrap gets its tail crossfaded into its head; the result still loops. */
function blendLoop(context: BaseAudioContext, buffer: AudioBuffer, seconds: number) {
  if (seamless(buffer)) return buffer;
  const overlap = Math.min(Math.floor(buffer.length / 4), Math.round(buffer.sampleRate * seconds));
  if (overlap < 2) return buffer;
  const length = buffer.length - overlap;
  const output = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const input = buffer.getChannelData(channel);
    const data = output.getChannelData(channel);
    data.set(input.subarray(overlap, length));
    for (let i = 0; i < overlap; i++) {
      const weight = (1 - Math.cos((Math.PI * i) / (overlap - 1))) / 2;
      data[length - overlap + i] = input[length + i] * (1 - weight) + input[i] * weight;
    }
  }
  return output;
}

interface Layer {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * The Tokyo Metro 13000's own motor: 21854F's BVE samples and speed tables, kept as the exact-train sound.
 * Each layer loops; its level and pitch follow the power or brake table for the current speed.
 */
export class BveMotor {
  private readonly layers: Layer[];
  private readonly rub: Layer;
  private readonly level: number;
  private readonly rubLevel: number;

  constructor(
    context: BaseAudioContext,
    output: AudioNode,
    private readonly profile: BveProfile,
    buffers: ReadonlyMap<string, AudioBuffer>,
  ) {
    const loop = (clip: string, overlap: number): Layer => {
      const buffer = buffers.get(clip);
      if (!buffer) throw new Error(`Missing motion clip ${clip}`);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = blendLoop(context, buffer, overlap);
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(output);
      source.start();
      return { source, gain };
    };
    this.level = fromDb(profile.levelDb);
    this.rubLevel = fromDb(profile.rubDb);
    this.layers = profile.layers.map((layer) => loop(layer.clip, 0.05));
    this.rub = loop(profile.rub, 0.06);
  }

  set(speedKmh: number, effort: Effort, when: number) {
    const moving = clamp(speedKmh / 0.7, 0, 1);
    const apply = (layer: Layer, gain: number, rate: number) => {
      layer.gain.gain.setTargetAtTime(gain, when, 0.015);
      // Rates of silent layers do not matter, but Web Audio needs them positive.
      layer.source.playbackRate.setTargetAtTime(Math.max(0.01, rate), when, 0.015);
    };
    this.profile.layers.forEach((table, index) => {
      const gain =
        effort.power * curve(table.power, speedKmh) + effort.brake * curve(table.brake, speedKmh);
      const rate = curve(effort.brake > 0 ? table.brakeRate : table.powerRate, speedKmh);
      apply(this.layers[index], moving * this.level * gain, rate);
    });
    const rub = this.rubLevel * effort.brake * moving * clamp((8 - speedKmh) / 5, 0, 1);
    apply(this.rub, rub, 1);
  }

  dispose() {
    for (const layer of [...this.layers, this.rub]) {
      layer.source.stop();
      layer.source.disconnect();
      layer.gain.disconnect();
    }
  }
}
