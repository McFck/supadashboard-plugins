import { BedShuffler } from './bed';
import { fromDb, hvacSteps } from './levels';
import type { Section, TrainProfile } from './manifest';
import { seeded, type Random } from './random';

/** The train sits this far under a voice cue, so announcements stay clear without the cabin vanishing. */
const DUCK_DB = -5;
/** Chrome adds automatic make-up gain after the limiter (about +3 dB at these settings); the trim allows for it. */
const TRIM_DB = -6;
const STANDING_DB = -12;
const HVAC_PLAN_SECONDS = 2 * 60 * 60;
/** Incommensurate drift periods: the combined pattern does not repeat for hours. */
const DRIFT_PERIODS = [97, 151, 223];

type Clips = ReadonlyMap<string, AudioBuffer>;

/**
 * The fixed part of one train's sound: buses, the tunnel/open space, the voice duck and limiter, slow drift,
 * and the beds that run whenever the graph exists (standing cabin, HVAC cycle, rolling per section, body
 * rumble). Everything is native Web Audio; the owner only moves parameter targets.
 */
export class TrainGraph {
  readonly train: GainNode;
  readonly events: GainNode;
  readonly platform: GainNode;
  readonly rollingFilter: BiquadFilterNode;
  readonly rollingGain: GainNode;
  readonly sectionGains: Partial<Record<Section, GainNode>>;
  readonly body: GainNode;
  readonly hvac: GainNode;
  readonly duck: GainNode;
  readonly beds: BedShuffler[] = [];
  private readonly rolling: Partial<Record<Section, BedShuffler>> = {};
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly lowShelf: BiquadFilterNode;
  private readonly highShelf: BiquadFilterNode;
  private readonly slap: GainNode;
  private readonly hvacFilter: BiquadFilterNode;
  private readonly random: Random;
  private duckUntil = 0;
  private hvacUntil: number;

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
    private readonly profile: TrainProfile,
    clips: Clips,
    noise: AudioBuffer,
  ) {
    const now = context.currentTime;
    this.random = seeded(Math.floor(Math.random() * 2 ** 32));
    const limiter = this.node(context.createDynamicsCompressor());
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.connect(output);
    this.duck = this.gain(1, this.gain(fromDb(TRIM_DB), limiter));
    this.highShelf = this.filter('highshelf', 6000, this.duck);
    this.lowShelf = this.filter('lowshelf', 250, this.highShelf);
    this.train = this.gain(1, this.lowShelf);
    this.platform = this.gain(0, this.duck);
    this.events = this.gain(1, this.train);
    // A short slapback off the tunnel walls, heard on the transients only.
    const delay = this.node(context.createDelay(0.1));
    delay.delayTime.value = 0.035;
    const feedback = this.gain(0.25, delay);
    delay.connect(feedback);
    this.slap = this.gain(0, this.train);
    delay.connect(this.slap);
    this.events.connect(delay);

    const [drift, rollingDrift, cutoffDrift] = DRIFT_PERIODS.map((period) => {
      const lfo = context.createOscillator();
      lfo.frequency.value = 1 / period;
      lfo.start(now + this.random() * period);
      this.sources.push(lfo);
      return lfo;
    });
    const cabin = this.gain(1, this.train);
    this.modulate(drift, 0.12, cabin.gain);
    const rollingBus = this.gain(1, this.train);
    this.modulate(rollingDrift, 0.15, rollingBus.gain);

    this.bed(clips, profile.beds.standing, this.gain(fromDb(STANDING_DB), cabin));
    this.hvac = this.gain(0, cabin);
    this.hvacFilter = this.filter('lowpass', profile.hvac.cutoff, this.hvac);
    this.bed(clips, profile.beds.hvac, this.hvacFilter);
    this.hvacUntil = now;
    this.planHvac(now);

    this.rollingGain = this.gain(0, rollingBus);
    this.rollingFilter = this.filter('lowpass', 700, this.rollingGain);
    // ±15 % on the cutoff, as cents so the drift scales with the speed-driven frequency.
    this.modulate(cutoffDrift, 240, this.rollingFilter.detune);
    this.sectionGains = {};
    for (const section of ['open', 'tunnel'] as const) {
      const clip = profile.beds.rolling[section];
      if (!clip) continue;
      const gain = this.gain(section === profile.sections.default ? 1 : 0, this.rollingFilter);
      this.sectionGains[section] = gain;
      this.rolling[section] = this.bed(clips, clip, gain, 1.15);
    }

    const rumble = context.createBufferSource();
    rumble.buffer = noise;
    rumble.loop = true;
    this.body = this.gain(0, this.train);
    rumble.connect(this.filter('lowpass', 160, this.body));
    rumble.start(now);
    this.sources.push(rumble);
  }

  private node<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  private gain(value: number, destination?: AudioNode) {
    const node = this.node(this.context.createGain());
    node.gain.value = value;
    if (destination) node.connect(destination);
    return node;
  }

  /** Adds a slow oscillator to a parameter, scaled to `depth` in the parameter's units. */
  private modulate(lfo: OscillatorNode, depth: number, param: AudioParam) {
    const scale = this.gain(depth);
    lfo.connect(scale);
    scale.connect(param);
  }

  private filter(type: BiquadFilterType, frequency: number, destination: AudioNode) {
    const node = this.node(this.context.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.connect(destination);
    return node;
  }

  private bed(clips: Clips, clip: string, destination: AudioNode, maxRate = 1) {
    const buffer = clips.get(clip);
    if (!buffer) throw new Error(`Missing motion clip ${clip}`);
    const bed = new BedShuffler(this.context, buffer, destination, this.random, { maxRate });
    bed.start(this.context.currentTime);
    this.beds.push(bed);
    return bed;
  }

  /** Schedules the compressor cycle hours ahead on the audio clock; extends itself as time passes. */
  planHvac(now: number) {
    if (this.hvacUntil > now + 600) return;
    const { levelDb, cutoff, cycleSeconds } = this.profile.hvac;
    const level = fromDb(levelDb);
    for (const step of hvacSteps(
      this.random,
      this.hvacUntil,
      now + HVAC_PLAN_SECONDS,
      cycleSeconds,
    )) {
      this.hvac.gain.setTargetAtTime(step.running ? level : level * 0.5, step.at, 0.8);
      this.hvacFilter.frequency.setTargetAtTime(step.running ? cutoff : cutoff * 0.6, step.at, 0.8);
      this.hvacUntil = step.at;
    }
  }

  setRollingRate(rate: number, when: number) {
    for (const bed of Object.values(this.rolling)) bed.setRate(rate, when);
  }

  /** Tunnel: more low end, duller top, slapback on transients. Open: flat. */
  setSpace(section: Section, when: number, tau: number) {
    const tunnel = section === 'tunnel';
    this.lowShelf.gain.setTargetAtTime(tunnel ? 3 : 0, when, tau);
    this.highShelf.gain.setTargetAtTime(tunnel ? -2 : 0, when, tau);
    this.slap.gain.setTargetAtTime(tunnel ? 0.3 : 0, when, tau);
    const bed = this.profile.beds.rolling[section] ? section : this.profile.sections.default;
    for (const [name, gain] of Object.entries(this.sectionGains))
      gain.gain.setTargetAtTime(name === bed ? 1 : 0, when, tau);
  }

  /** Lowers the train under a voice cue; overlapping cues extend one duck. */
  duckFor(when: number, seconds: number) {
    this.duckUntil = Math.max(this.duckUntil, when + seconds);
    this.duck.gain.cancelScheduledValues(when);
    this.duck.gain.setTargetAtTime(fromDb(DUCK_DB), when, 0.08);
    this.duck.gain.setTargetAtTime(1, this.duckUntil, 0.35);
  }

  dispose() {
    for (const bed of this.beds) bed.stop(0);
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    for (const node of this.nodes) node.disconnect();
  }
}
