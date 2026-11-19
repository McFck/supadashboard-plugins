import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSnapshot } from '../simulation/run';
import type { ResolvedCue } from './sound-types';
import { createSubwayAudio } from './audio';
import { playCueSource } from './cue-source';
import { TrainSound } from './motion/train-sound';

vi.mock('./motion/train-sound', () => ({ TrainSound: { load: vi.fn() } }));
vi.mock('./cue-source', () => ({ playCueSource: vi.fn() }));

function audioParam() {
  return {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

function source() {
  const listeners = new Map<string, () => void>();
  const node = {
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    }),
    finish: () => listeners.get('ended')?.(),
  };
  node.connect.mockReturnValue(node);
  return node;
}

function makeAudioHarness() {
  const gains: {
    gain: ReturnType<typeof audioParam>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const sources: ReturnType<typeof source>[] = [];
  const oscillators: ReturnType<typeof source>[] = [];
  let now = 5;
  let state = 'suspended';
  const context = {
    get currentTime() {
      return now;
    },
    set currentTime(value: number) {
      now = value;
    },
    get state() {
      return state;
    },
    destination: {},
    createGain: vi.fn(() => {
      const node = { gain: audioParam(), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(node);
      return node;
    }),
    createOscillator: vi.fn(() => {
      const node = { ...source(), frequency: audioParam(), start: vi.fn(), stop: vi.fn() };
      oscillators.push(node);
      return node;
    }),
    decodeAudioData: vi.fn(async () => ({ length: 100, numberOfChannels: 1 })),
    resume: vi.fn(async () => {
      state = 'running';
    }),
    suspend: vi.fn(async () => {
      state = 'suspended';
    }),
    close: vi.fn(async () => {
      state = 'closed';
    }),
  } as unknown as AudioContext & { currentTime: number; gains: typeof gains };
  const motion = {
    update: vi.fn(),
    duck: vi.fn(),
    resync: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(TrainSound.load).mockImplementation(async () => motion as unknown as TrainSound);
  const played: {
    destination: AudioNode;
    cue: ResolvedCue;
    when: number;
    source: ReturnType<typeof source>;
  }[] = [];
  vi.mocked(playCueSource).mockImplementation((_context, destination, _buffer, cue, when) => {
    const node = source();
    sources.push(node);
    played.push({ destination, cue, when, source: node });
    return node as unknown as AudioBufferSourceNode;
  });
  const trains = [
    { id: 'e235', lines: ['yamanote'] },
    { id: 'hankyu-1300', lines: ['sakaisuji'] },
  ];
  const loadMotion = vi.fn(async () => ({
    manifest: { version: 1, clips: {}, trains },
    urlFor: (clip: string) => clip,
  })) as unknown as NonNullable<Parameters<typeof createSubwayAudio>[0]>['loadMotion'];
  const fetch = vi.fn(
    async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as Response,
  );
  const contextFactory = vi.fn(() => context);
  const audio = createSubwayAudio({ contextFactory, loadMotion, fetch });
  return {
    audio,
    context,
    contextFactory,
    motion,
    loadMotion,
    fetch,
    played,
    gains,
    sources,
    oscillators,
  };
}

const snapshot = (patch: Partial<RunSnapshot> = {}): RunSnapshot => ({
  station: 'JY01',
  next: 'JY02',
  state: 'cruising',
  line: 'yamanote',
  direction: 'inner',
  doorSide: 'unknown',
  doors: 'closed',
  speed: 24,
  power: 0.5,
  brake: 0,
  progress: 0.3,
  paused: false,
  immersion: true,
  generation: 0,
  multiplier: 1,
  remainingMinutes: 4,
  ...patch,
});

const cue: ResolvedCue = {
  file: 'lines/yamanote/voice.opus',
  offset: 1,
  duration: 0.2,
  audible_end: 0.18,
  gainByRole: { voice: 0.8 },
  sha256: 'a'.repeat(64),
  status: 'approved',
  source: 'fixture',
  gain: 0.8,
  role: 'voice',
  url: '/subway/lines/yamanote/voice.opus',
};

async function ready() {
  const harness = makeAudioHarness();
  harness.audio.setVisible(true);
  harness.audio.setEnabled(true, true);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  harness.audio.transition(snapshot(), []);
  return harness;
}

describe('Subway immersion audio', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates its context only after immersion and drives the line train through the cue bus', async () => {
    const harness = makeAudioHarness();
    harness.audio.setVisible(true);
    expect(harness.context.createGain).not.toHaveBeenCalled();
    harness.audio.setEnabled(true, true);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    harness.audio.transition(snapshot(), []);
    expect(harness.context.resume).toHaveBeenCalledOnce();
    expect(harness.loadMotion).toHaveBeenCalledOnce();
    expect(vi.mocked(TrainSound.load).mock.calls[0].slice(0, 3)).toEqual([
      harness.context,
      harness.gains[0],
      { id: 'e235', lines: ['yamanote'] },
    ]);
    expect(harness.motion.update).toHaveBeenCalledWith(snapshot());
  });

  it('uses a dedicated voice bus and late decode skips elapsed cue audio at natural rate', async () => {
    const harness = await ready();
    const effect = { type: 'play-cue', id: 'arrival:ja', cue, generation: 0 } as const;
    const pending = harness.audio.playCue(effect);
    harness.context.currentTime = 5.05;
    await pending;
    expect(harness.played).toHaveLength(1);
    expect(harness.played[0].destination).toBe(harness.gains[1]);
    expect(harness.played[0].cue.offset).toBeCloseTo(1.05);
    expect(harness.played[0].cue.duration).toBeCloseTo(0.15);
    expect(harness.played[0].cue.role).toBe('voice');
    expect(harness.played[0].when).toBe(5.05);
    expect(harness.motion.duck).toHaveBeenCalledWith(5.05, harness.played[0].cue.duration);
    await harness.audio.playCue(effect);
    expect(harness.fetch).toHaveBeenCalledOnce();
  });

  it('keeps simulation state updates independent from mixer mute and preserves sources while hidden', async () => {
    const harness = await ready();
    harness.audio.transition(snapshot(), []);
    harness.audio.setMix(0.4, true);
    expect(harness.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 5, 0.015);
    harness.audio.transition(snapshot({ speed: 30, power: 0.25 }), []);
    expect(harness.motion.update).toHaveBeenLastCalledWith(snapshot({ speed: 30, power: 0.25 }));
    const effect = { type: 'play-cue', id: 'arrival:ja', cue, generation: 0 } as const;
    await harness.audio.playCue(effect);
    harness.audio.setMix(1, false);
    harness.audio.setVisible(false);
    expect(harness.context.suspend).toHaveBeenCalledOnce();
    expect(harness.sources[0].stop).not.toHaveBeenCalled();
    harness.audio.setVisible(true);
    expect(harness.context.resume).toHaveBeenCalledTimes(2);
    harness.audio.setEnabled(false);
    expect(harness.motion.dispose).toHaveBeenCalledOnce();
    expect(harness.context.close).toHaveBeenCalledOnce();
  });

  it('cancels an old decoded cue after a line generation change and emits one synthetic alert per incident', async () => {
    const harness = await ready();
    let resolveFetch!: (response: Response) => void;
    harness.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const effect = { type: 'play-cue', id: 'arrival:ja', cue, generation: 0 } as const;
    const pending = harness.audio.playCue(effect);
    harness.audio.transition(snapshot({ line: 'sakaisuji', generation: 1 }), []);
    resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response);
    await pending;
    expect(harness.played).toHaveLength(0);
    const emergency = { type: 'emergency', generation: 1 } as const;
    harness.audio.transition(snapshot({ line: 'sakaisuji', generation: 1, state: 'emergency' }), [
      emergency,
    ]);
    expect(harness.oscillators).toHaveLength(2);
    harness.audio.transition(snapshot({ line: 'sakaisuji', generation: 1, state: 'emergency' }), [
      emergency,
    ]);
    expect(harness.oscillators).toHaveLength(2);
  });

  it('preloads only when immersion is visible and drops its context on disposal', async () => {
    const harness = await ready();
    harness.audio.preload([cue]);
    await Promise.resolve();
    expect(harness.fetch).toHaveBeenCalledOnce();
    harness.audio.dispose();
    expect(harness.context.close).toHaveBeenCalledOnce();
  });

  it('closes the current context and invalidates profile resources on a line reset', async () => {
    const harness = await ready();
    harness.audio.resetLine(true);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(harness.context.close).toHaveBeenCalledOnce();
    expect(harness.contextFactory).toHaveBeenCalledTimes(2);
    expect(harness.context.resume).toHaveBeenCalledTimes(2);
    harness.audio.dispose();
  });
});
