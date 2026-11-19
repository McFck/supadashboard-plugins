import type { MotorProfile } from './manifest';
import { clamp, curve, fromDb, type Effort } from './levels';

type VvvfProfile = Extract<MotorProfile, { kind: 'vvvf' }>;

/** Sideband depth of the PWM approximation: the carrier swings by this many motor frequencies. */
const MODULATION_INDEX = 2.2;

export class VvvfMotor {
  private readonly carrier: OscillatorNode;
  private readonly modulator: OscillatorNode;
  private readonly depth: GainNode;
  private readonly tone: GainNode;
  private readonly hum: OscillatorNode;
  private readonly humFilter: BiquadFilterNode;
  private readonly humGain: GainNode;
  private readonly level: number;

  constructor(
    context: BaseAudioContext,
    output: AudioNode,
    private readonly profile: VvvfProfile,
  ) {
    this.level = fromDb(profile.levelDb);
    this.carrier = context.createOscillator();
    this.modulator = context.createOscillator();
    this.depth = context.createGain();
    this.tone = context.createGain();
    this.hum = context.createOscillator();
    this.hum.type = 'sawtooth';
    this.humFilter = context.createBiquadFilter();
    this.humFilter.frequency.value = 700;
    this.humGain = context.createGain();
    this.tone.gain.value = 0;
    this.humGain.gain.value = 0;
    this.modulator.connect(this.depth).connect(this.carrier.frequency);
    this.carrier.connect(this.tone).connect(output);
    this.hum.connect(this.humFilter).connect(this.humGain).connect(output);
    for (const node of [this.carrier, this.modulator, this.hum]) node.start();
  }

  /** Electrical frequency in Hz: wheel turns per second through the gear, times the pole pairs. */
  private motorHz(speedKmh: number) {
    const { gear, wheel, polePairs } = this.profile;
    return Math.max(0.5, (speedKmh / 3.6 / (Math.PI * wheel)) * gear * polePairs);
  }

  set(speedKmh: number, effort: Effort, when: number) {
    const fo = this.motorHz(speedKmh);
    const pulses = this.profile.sync.findLast(([from]) => speedKmh >= from)?.[1] ?? 0;
    const fc = pulses > 0 ? pulses * fo : curve(this.profile.carrier, speedKmh);
    const drive =
      effort.power > 0
        ? effort.power * clamp(0.35 + speedKmh / 2, 0, 1)
        : effort.brake * clamp((speedKmh - 4) / 4, 0, 1);
    const ramp = (param: AudioParam, value: number, tau: number) =>
      param.setTargetAtTime(value, when, tau);
    ramp(this.carrier.frequency, fc, 0.03);
    ramp(this.modulator.frequency, fo, 0.03);
    ramp(this.depth.gain, MODULATION_INDEX * fo, 0.03);
    ramp(this.hum.frequency, fo, 0.03);
    ramp(this.tone.gain, drive * this.level * 0.25, 0.05);
    ramp(this.humGain.gain, drive * this.level * fromDb(this.profile.humDb) * 0.2, 0.05);
  }

  dispose() {
    for (const node of [this.carrier, this.modulator, this.hum]) {
      node.stop();
      node.disconnect();
    }
    for (const node of [this.depth, this.tone, this.humFilter, this.humGain]) node.disconnect();
  }
}
