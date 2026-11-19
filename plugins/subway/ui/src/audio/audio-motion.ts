import type { LoadedSubwayMotion } from './asset-loader';
import type { AudioGraph } from './audio-cues';
import { TrainSound } from './motion/train-sound';

export interface TrainMotionHost {
  loadMotion(): Promise<LoadedSubwayMotion>;
  fetch: typeof fetch;
  warnOnce(key: string, error: unknown): void;
  ready(sound: TrainSound, graph: AudioGraph): void;
  failed(): void;
}

type MotionState =
  | { kind: 'idle' }
  | { kind: 'loading'; line: string; promise: Promise<void> }
  | { kind: 'ready'; line: string; sound: TrainSound };

/** The train sound of the shown line; every line has its own train, loaded on demand. */
export class TrainMotion {
  private state: MotionState = { kind: 'idle' };
  private pack: Promise<LoadedSubwayMotion> | undefined;

  constructor(private readonly host: TrainMotionHost) {}

  get sound(): TrainSound | undefined {
    return this.state.kind === 'ready' ? this.state.sound : undefined;
  }

  ensure(line: string, graph: AudioGraph): Promise<void> {
    if (this.state.kind !== 'idle' && this.state.line === line) {
      return this.state.kind === 'loading' ? this.state.promise : Promise.resolve();
    }
    this.reset(false);
    const promise = this.load(line, graph);
    this.state = { kind: 'loading', line, promise };
    return promise;
  }

  /** Drops the train sound; `dropPack` also forgets the motion manifest, as a closing context does. */
  reset(dropPack = true): void {
    if (this.state.kind === 'ready') {
      this.state.sound.dispose();
    }
    this.state = { kind: 'idle' };
    if (dropPack) {
      this.pack = undefined;
    }
  }

  private load(line: string, graph: AudioGraph): Promise<void> {
    const current = () => this.state.kind === 'loading' && this.state.promise === promise;
    // Assigned before the first await: `current()` compares against the promise this call returns.
    const promise = (async () => {
      try {
        const pack = await this.motionPack();
        if (!current()) {
          return;
        }
        const profile = pack.manifest.trains.find((train) => train.lines.includes(line));
        if (!profile) {
          throw new Error(`Missing ${line} train sound`);
        }
        const sound = await TrainSound.load(
          graph.context,
          graph.cueBus,
          profile,
          pack.urlFor,
          this.host.fetch,
        );
        if (!current()) {
          sound.dispose();
          return;
        }
        this.state = { kind: 'ready', line, sound };
        this.host.ready(sound, graph);
      } catch (error) {
        if (current()) {
          this.state = { kind: 'idle' };
          this.host.failed();
          this.host.warnOnce(`profile:${line}`, error);
        }
      }
    })();
    return promise;
  }

  private motionPack(): Promise<LoadedSubwayMotion> {
    this.pack ??= this.host.loadMotion().catch((error: unknown) => {
      this.pack = undefined;
      this.host.warnOnce('motion', error);
      throw error;
    });
    return this.pack;
  }
}
