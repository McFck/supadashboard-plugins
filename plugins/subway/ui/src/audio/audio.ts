import { SUBWAY_DEFAULT_CONFIG } from '../simulation/config';
import type { RunSnapshot } from '../simulation/run';
import type { RunEffect } from '../simulation/run-state';
import type { ResolvedCue } from './sound-types';
import { loadSubwayMotion } from './asset-loader';
import { CuePlayer, type AudioGraph } from './audio-cues';
import { TrainMotion } from './audio-motion';
import { subscribeSubwayMixerSettings } from './audio-volume';

export type SubwayAudioOptions = {
  contextFactory?: () => AudioContext;
  loadMotion?: typeof loadSubwayMotion;
  fetch?: typeof fetch;
  onAvailability?: (available: boolean) => void;
};

export interface SubwayAudioController {
  setEnabled(enabled: boolean, fromGesture?: boolean): void;
  resetLine(fromGesture?: boolean): void;
  setVisible(visible: boolean): void;
  setMix(volume: number, muted: boolean): void;
  setAnnouncementVolume(volume: number): void;
  transition(snapshot: RunSnapshot, effects: readonly RunEffect[]): void;
  preload(cues: readonly ResolvedCue[]): void;
  playCue(effect: Extract<RunEffect, { type: 'play-cue' }>): Promise<void>;
  dispose(): void;
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * Immersion audio: one AudioContext, open while immersion is on and the applet eligible, carrying the line's
 * train sound and the run's cues. Hidden, the context is suspended rather than closed so sources resume.
 */
export function createSubwayAudio(options: SubwayAudioOptions = {}): SubwayAudioController {
  const makeContext = options.contextFactory ?? (() => new AudioContext());
  const fetchAsset = options.fetch ?? globalThis.fetch.bind(globalThis);
  let graph: AudioGraph | undefined;
  /** The line whose train plays; until the first snapshot, the default line's train loads ahead. */
  let currentLine: string = SUBWAY_DEFAULT_CONFIG.line;
  let currentSnapshot: RunSnapshot | undefined;
  let enabled = false;
  let visible = false;
  let disposed = false;
  /** Counts visibility changes, so a suspend that finishes after the applet came back resumes again. */
  let visibilityEpoch = 0;
  let audioGeneration = -1;
  let mixVolume = 1;
  let mixMuted = false;
  let announcementVolume = 0.8;
  let availabilityKnown: boolean | undefined;
  const failed = new Set<string>();
  const cues = new CuePlayer({
    fetch: fetchAsset,
    graph: () => graph,
    disposed: () => disposed,
    warnOnce,
    duck: (when, seconds) => motion.sound?.duck(when, seconds),
  });
  const motion = new TrainMotion({
    loadMotion: () => (options.loadMotion ?? loadSubwayMotion)(),
    fetch: fetchAsset,
    warnOnce,
    ready: (sound, readyGraph) => {
      if (currentSnapshot) {
        sound.update(currentSnapshot);
      }
      setAvailability(readyGraph.context.state === 'running');
    },
    failed: () => setAvailability(false),
  });

  function playing(): boolean {
    return enabled && visible && !disposed;
  }

  function setAvailability(available: boolean) {
    if (availabilityKnown !== available) {
      availabilityKnown = available;
      options.onAvailability?.(available);
    }
  }

  function warnOnce(key: string, error: unknown) {
    if (!failed.has(key)) {
      failed.add(key);
      console.warn(`Subway audio unavailable (${key})`, error);
    }
  }

  function applyGains(immediate = false) {
    if (!graph) {
      return;
    }
    const now = graph.context.currentTime;
    const cue = visible && enabled && !mixMuted ? mixVolume : 0;
    for (const [param, value] of [
      [graph.cueBus.gain, cue],
      [graph.voiceBus.gain, cue * announcementVolume],
    ] as const) {
      param.cancelScheduledValues(now);
      if (immediate) {
        param.setValueAtTime(value, now);
      } else {
        param.setTargetAtTime(value, now, 0.015);
      }
    }
  }

  function ensureGraph(): AudioGraph | undefined {
    if (graph || !playing()) {
      return graph;
    }
    if (!options.contextFactory && typeof AudioContext === 'undefined') {
      return undefined;
    }
    try {
      const context = makeContext();
      graph = { context, cueBus: context.createGain(), voiceBus: context.createGain() };
      graph.voiceBus.connect(graph.cueBus);
      graph.cueBus.connect(context.destination);
      graph.cueBus.gain.value = 0;
      graph.voiceBus.gain.value = 0;
      applyGains(true);
      setAvailability(false);
      return graph;
    } catch (error) {
      setAvailability(false);
      warnOnce('context', error);
      return undefined;
    }
  }

  function closeGraph() {
    cues.stop();
    motion.reset();
    const closing = graph;
    graph = undefined;
    cues.clear();
    if (!closing) {
      return;
    }
    closing.cueBus.disconnect();
    closing.voiceBus.disconnect();
    if (closing.context.state !== 'closed') {
      void closing.context
        .close()
        .catch((error: unknown) => console.warn('Subway audio context did not close', error));
    }
  }

  function ensureMotion(line: string) {
    const current = ensureGraph();
    if (current) {
      currentLine = line;
      void motion.ensure(line, current);
    }
  }

  function resumeContext(fromGesture: boolean) {
    const context = graph?.context;
    if (!context || !playing() || context.state === 'running') {
      return;
    }
    const failedResume = (error: unknown) => {
      setAvailability(false);
      warnOnce(fromGesture ? 'unlock' : 'resume', error);
    };
    try {
      void context
        .resume()
        .then(() => {
          if (graph && playing()) {
            applyGains(true);
            if (motion.sound) {
              setAvailability(true);
            }
          }
        })
        .catch(failedResume);
    } catch (error) {
      failedResume(error);
    }
  }

  function setEnabled(value: boolean, fromGesture = false) {
    if (disposed) {
      return;
    }
    if (enabled === value) {
      if (value && fromGesture && visible) {
        ensureGraph();
        resumeContext(true);
        ensureMotion(currentLine);
      }
      return;
    }
    enabled = value;
    if (!value) {
      closeGraph();
      setAvailability(false);
      return;
    }
    if (visible) {
      ensureGraph();
      resumeContext(fromGesture);
      ensureMotion(currentLine);
    }
  }

  function resetLine(fromGesture = false) {
    if (enabled) {
      setEnabled(false);
      setEnabled(true, fromGesture);
    }
  }

  function setVisible(value: boolean) {
    if (disposed || visible === value) {
      return;
    }
    visible = value;
    const request = ++visibilityEpoch;
    if (!enabled) {
      return;
    }
    if (value) {
      ensureGraph();
      resumeContext(false);
      applyGains(true);
      motion.sound?.resync();
      if (currentSnapshot) {
        transition(currentSnapshot, []);
      }
      ensureMotion(currentLine);
      return;
    }
    const suspended = graph?.context;
    if (!suspended) {
      return;
    }
    applyGains(true);
    void suspended
      .suspend()
      .then(() => {
        if (visibilityEpoch !== request && playing() && graph?.context === suspended) {
          resumeContext(false);
        }
      })
      .catch((error: unknown) => warnOnce('suspend', error));
  }

  function setMix(volume: number, muted: boolean) {
    mixVolume = clamp(volume);
    mixMuted = muted;
    applyGains();
  }

  function setAnnouncementVolume(volume: number) {
    announcementVolume = clamp(volume);
    applyGains();
  }

  function preload(list: readonly ResolvedCue[]) {
    if (playing() && graph) {
      cues.preload(list);
    }
  }

  function transition(snapshot: RunSnapshot, effects: readonly RunEffect[]) {
    currentSnapshot = snapshot;
    if (audioGeneration !== snapshot.generation) {
      audioGeneration = snapshot.generation;
      cues.stop();
    }
    currentLine = snapshot.line;
    if (snapshot.immersion !== enabled) {
      setEnabled(snapshot.immersion);
    }
    if (playing()) {
      if (!snapshot.paused) {
        ensureMotion(snapshot.line);
      }
      motion.sound?.update(snapshot);
    }
    if (effects.some((effect) => effect.type === 'emergency')) {
      cues.alert(snapshot.generation, mixMuted || !playing());
    }
  }

  async function playCue(effect: Extract<RunEffect, { type: 'play-cue' }>) {
    if (!playing() || !graph || effect.generation !== audioGeneration) {
      return;
    }
    await cues.play(effect, () => playing() && effect.generation === audioGeneration);
  }

  function dispose() {
    if (!disposed) {
      setEnabled(false);
      disposed = true;
      cues.stop();
      unsubscribeMixer();
    }
  }

  const unsubscribeMixer = subscribeSubwayMixerSettings((settings) =>
    setMix(settings.volume, settings.muted),
  );
  return {
    setEnabled,
    resetLine,
    setVisible,
    setMix,
    setAnnouncementVolume,
    transition,
    preload,
    playCue,
    dispose,
  };
}
