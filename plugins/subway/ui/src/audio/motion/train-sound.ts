import type { RunSnapshot } from '../../simulation/run';
import { BveMotor } from './bve-motor';
import { createJointScheduler, type TrackLayout } from './joints';
import { clamp, fromDb, rollingLevels, sectionAt, slewEffort, type Effort } from './levels';
import type { Section, TrainProfile } from './manifest';
import { OneShots } from './one-shots';
import { PlatformAir } from './platform';
import { between, createPicker, hashSeed, seeded, type Random } from './random';
import { Squeal } from './squeal';
import { TrainGraph } from './train-graph';
import { VvvfMotor } from './vvvf';

/** Seconds of audio-clock lookahead; the run ticks every 50 ms while moving. */
const LOOKAHEAD_SECONDS = 0.25;
const BODY_DB = -16;
const RELEASE_DB = -18;
const RATTLE_DB = -24;
const PLATFORM_DB = -9;
const BRAKE_SQUEAL_DB = -34;
const MOVING = new Set<RunSnapshot['state']>([
  'departing',
  'cruising',
  'approaching',
  'emergency',
  'suspended',
]);

interface Segment {
  key: string;
  random: Random;
  layout: TrackLayout & { points: number[] };
  joints: ReturnType<typeof createJointScheduler>;
  curve?: readonly [number, number];
  brakeSqueal: boolean;
  approachPoints?: number;
}

interface Previous {
  speed: number;
  power: number;
  brake: number;
  section: Section;
  platform: boolean;
}

function trainClips(profile: TrainProfile): string[] {
  const { beds, pools, motor } = profile;
  return [
    ...new Set([
      beds.standing,
      beds.hvac,
      ...Object.values(beds.rolling),
      ...pools.joint,
      ...pools.release,
      ...pools.rattle,
      ...(motor.kind === 'bve' ? [...motor.layers.map((layer) => layer.clip), motor.rub] : []),
    ]),
  ].filter((clip): clip is string => !!clip);
}

function noiseBuffer(context: BaseAudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  return buffer;
}

export class TrainSound {
  private readonly graph: TrainGraph;
  private readonly motor: VvvfMotor | BveMotor;
  private readonly squeal: Squeal;
  private readonly shots: OneShots;
  private readonly jointFilter: BiquadFilterNode;
  private readonly motorBus: GainNode;
  private readonly random = seeded(Math.floor(Math.random() * 2 ** 32));
  private readonly picks: Record<keyof TrainProfile['pools'], () => AudioBuffer>;
  private previous: Previous | undefined;
  private generation = -1;
  private effort: Effort = { power: 0, brake: 1 };
  private odometer = 0;
  private segment: Segment | undefined;
  private readonly platform: PlatformAir;
  private squealing = false;
  private lastTime = 0;
  private stale = true;

  static async load(
    context: BaseAudioContext,
    output: AudioNode,
    profile: TrainProfile,
    urlFor: (clip: string) => string,
    fetchAsset: typeof fetch,
  ): Promise<TrainSound> {
    const decode = async (clip: string) => {
      const response = await fetchAsset(urlFor(clip));
      if (!response.ok) throw new Error(`Motion clip request failed (${response.status}): ${clip}`);
      return context.decodeAudioData(await response.arrayBuffer());
    };
    const entries = await Promise.all(
      trainClips(profile).map(async (clip) => [clip, await decode(clip)] as const),
    );
    // A line change or immersion off can close the context while the clips load; build nothing on it.
    if (context.state === 'closed') throw new Error('Subway audio context closed while loading');
    return new TrainSound(context, output, profile, new Map(entries), (section) =>
      decode(profile.beds.platform[section]),
    );
  }

  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
    private readonly profile: TrainProfile,
    private readonly clips: ReadonlyMap<string, AudioBuffer>,
    loadPlatform: (section: Section) => Promise<AudioBuffer>,
  ) {
    const noise = noiseBuffer(context);
    this.graph = new TrainGraph(context, output, profile, clips, noise);
    this.shots = new OneShots(context, noise);
    this.squeal = new Squeal(context, this.graph.events);
    this.jointFilter = context.createBiquadFilter();
    this.jointFilter.frequency.value = profile.track.jointCutoff;
    this.jointFilter.connect(this.graph.events);
    this.motorBus = context.createGain();
    this.motorBus.connect(this.graph.train);
    this.motor =
      profile.motor.kind === 'bve'
        ? new BveMotor(context, this.motorBus, profile.motor, clips)
        : new VvvfMotor(context, this.motorBus, profile.motor);
    const pool = (ids: readonly string[]) => {
      const pick = createPicker(ids.length, this.random);
      return () => this.clip(ids[pick()]);
    };
    this.platform = new PlatformAir(
      context,
      this.graph.platform,
      this.random,
      loadPlatform,
      fromDb(PLATFORM_DB),
    );
    this.picks = {
      joint: pool(profile.pools.joint),
      release: pool(profile.pools.release),
      rattle: pool(profile.pools.rattle),
    };
  }

  private clip(id: string): AudioBuffer {
    const buffer = this.clips.get(id);
    if (!buffer) throw new Error(`Missing motion clip ${id}`);
    return buffer;
  }

  resync() {
    this.stale = true;
  }

  duck(when: number, seconds: number) {
    this.graph.duckFor(when, seconds);
  }

  update(snapshot: RunSnapshot) {
    if (snapshot.paused) {
      this.stale = true;
      return;
    }
    const now = this.context.currentTime;
    const snap = this.stale || snapshot.generation !== this.generation || !this.previous;
    const seconds = snap ? 0 : now - this.lastTime;
    this.stale = false;
    this.generation = snapshot.generation;
    this.lastTime = now;
    const { speed, power, brake } = snapshot;
    const moving = MOVING.has(snapshot.state) && speed > 0;
    if (snap) {
      this.shots.cancel();
      this.effort = { power, brake };
    } else this.effort = slewEffort(this.effort, { power, brake }, seconds);
    const average = ((this.previous?.speed ?? speed) + speed) / 2;
    this.odometer += (average / 3.6) * seconds;
    this.enterSegment(snapshot, moving, snap);
    const section = moving
      ? sectionAt(this.profile.sections, snapshot.station, snapshot.next, snapshot.progress)
      : sectionAt(this.profile.sections, snapshot.station, '', 0);
    const tau = (seconds: number) => (snap ? 0.005 : seconds);
    const rolling = rollingLevels(speed);
    this.graph.rollingGain.gain.setTargetAtTime(rolling.gain, now, tau(0.08));
    this.graph.rollingFilter.frequency.setTargetAtTime(rolling.cutoff, now, tau(0.08));
    this.graph.setRollingRate(rolling.rate, now);
    this.graph.body.gain.setTargetAtTime(fromDb(BODY_DB) * (speed / 60) ** 2, now, tau(0.1));
    this.graph.setSpace(section, now, tau(0.5));
    this.graph.planHvac(now);
    this.motor.set(speed, this.effort, now);
    this.scheduleJoints(speed, now);
    this.updateSqueal(snapshot, now, snap);
    const platform = !moving && (snapshot.doors === 'opening' || snapshot.doors === 'open');
    this.platform.update(platform, section, now, snap);
    if (!snap && this.previous) this.edges(this.previous, snapshot, section, now);
    this.previous = { speed, power, brake, section, platform };
  }

  private enterSegment(snapshot: RunSnapshot, moving: boolean, snap: boolean) {
    const key = `${snapshot.generation}|${snapshot.station}|${snapshot.next}|${snapshot.direction}`;
    if (!moving || this.segment?.key === key) return;
    const { track, termini, car } = this.profile;
    const random = seeded(hashSeed(`${snapshot.line}|${snapshot.station}|${snapshot.next}`));
    this.odometer = 0;
    const points: number[] = [];
    const layout = { seed: random() * 2 ** 32, spacing: track.jointSpacing, car, points };
    const joints = createJointScheduler(layout);
    joints.reset(0);
    const leavesTerminus = termini.includes(snapshot.station);
    if (!snap && (leavesTerminus || random() < track.pointsChance))
      this.addPoints(points, between(random, 30, 150), random);
    const arrivesTerminus = termini.includes(snapshot.next);
    this.segment = {
      key,
      random,
      layout,
      joints,
      curve: random() < track.curveShare ? this.curveWindow(random) : undefined,
      brakeSqueal: this.random() < track.brakeSquealChance,
      approachPoints:
        arrivesTerminus || random() < track.pointsChance ? between(random, 22, 38) : undefined,
    };
  }

  private curveWindow(random: Random) {
    const start = between(random, 0.25, 0.6);
    return [start, start + between(random, 0.08, 0.25)] as const;
  }

  private addPoints(points: number[], from: number, random: Random) {
    let at = from;
    const count = Math.round(between(random, 4, 8));
    for (let index = 0; index < count; index++) {
      points.push(at);
      at += between(random, 3, 12);
    }
  }

  private scheduleJoints(speed: number, now: number) {
    const segment = this.segment;
    if (!segment) return;
    const level = fromDb(this.profile.track.jointDb);
    for (const hit of segment.joints.take(this.odometer, speed, LOOKAHEAD_SECONDS)) {
      const when = Math.max(now, now + hit.delay + between(this.random, -0.004, 0.004));
      const gain = level * hit.gain * fromDb(between(this.random, -1.5, 1.5));
      const rate = between(this.random, 0.97, 1.03) * (hit.heavy ? 0.92 : 1);
      this.shots.sample(this.picks.joint(), this.jointFilter, when, gain, rate);
      if (speed > 30 && this.random() < 0.03)
        this.shots.sample(this.picks.rattle(), this.graph.events, when + 0.01, fromDb(RATTLE_DB));
    }
  }

  private updateSqueal(snapshot: RunSnapshot, now: number, snap: boolean) {
    const segment = this.segment;
    const { speed, brake, progress } = snapshot;
    let level = 0;
    if (segment?.curve && progress >= segment.curve[0] && progress <= segment.curve[1])
      level =
        fromDb(this.profile.track.curveDb) *
        clamp((speed - 15) / 10, 0, 1) *
        clamp((45 - speed) / 10, 0, 1);
    if (segment?.brakeSqueal && brake > 0 && speed > 0.3 && speed < 8)
      level = Math.max(level, fromDb(BRAKE_SQUEAL_DB) * (1 - speed / 8) ** 0.5);
    if (snap) level = 0;
    if (level > 0 && !this.squealing) {
      const [low, high] = speed < 8 ? [2500, 3800] : [3000, 5000];
      this.squeal.retune(this.random, low, high, now);
    }
    this.squealing = level > 0;
    this.squeal.set(level, now, level > 0 ? 0.25 : 0.12);
  }

  private edges(previous: Previous, snapshot: RunSnapshot, section: Section, now: number) {
    const { speed, power, brake } = snapshot;
    const events = this.graph.events;
    if (previous.brake > 0 && brake === 0 && speed < 1)
      this.shots.sample(this.picks.release(), events, now, fromDb(RELEASE_DB));
    if (previous.speed > 0 && speed === 0) {
      this.shots.thump(events, now, 0.35, 90, 0.5);
      if (this.random() < 0.6)
        this.shots.sample(this.picks.rattle(), events, now + 0.08, fromDb(RATTLE_DB));
    }
    const departing = previous.power === 0 && power > 0 && speed < 1;
    const braking = previous.brake === 0 && brake > 0 && speed > 5;
    if ((departing || braking) && this.random() < 0.5)
      this.shots.sample(this.picks.rattle(), events, now + 0.15, fromDb(RATTLE_DB - 3));
    if (speed > 5 && section !== previous.section)
      this.shots.thump(events, now, 0.6 * (speed / 60), 120, 0.9);
    const approach = this.segment?.approachPoints;
    if (this.segment && approach !== undefined && brake > 0 && speed < approach && speed > 5) {
      this.addPoints(
        this.segment.layout.points,
        this.odometer + between(this.random, 5, 20),
        this.random,
      );
      this.segment.approachPoints = undefined;
    }
  }

  dispose() {
    this.shots.cancel();
    this.platform.dispose();
    this.motor.dispose();
    this.squeal.dispose();
    this.jointFilter.disconnect();
    this.motorBus.disconnect();
    this.graph.dispose();
  }
}
