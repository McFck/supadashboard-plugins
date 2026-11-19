import { get } from 'svelte/store';
import type { AppletRuntimeContext, EventAncestry } from '@supadashboard/kit';
import { normalizeSubwayLines, stepStation, type LineDefinition } from './lines';
import {
  announcementLanguages,
  normalizeSubwayConfig,
  type NormalizedSubwayConfig,
} from './config';
import { createSubwayAudio, type SubwayAudioController } from '../audio/audio';
import { loadSubwayAssets, loadSubwayMotion, SUBWAY_ASSET_BASE } from '../audio/asset-loader';
import type { LoadedSubwayAssets } from '../audio/sound-types';
import { buildCuePlans } from './cue-plans';
import {
  requestedRoute,
  resolveLineRequest,
  type LineRequest,
  routeFromConfig,
  type RouteOverrides,
} from './line-request';
import { ProjectionQueue } from './projection-queue';
import { createRunState, nextRunWake, reduceRun, snapshotRun, type RunSnapshot } from './run';
import {
  lineFor,
  type RunCommand,
  type RunEffect,
  type SubwayCuePlans,
  type SubwayRunState,
} from './run-state';
import { ScenePublisher } from './scene-state';

export interface SubwayRuntimeClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SubwayRuntimeOptions {
  clock?: SubwayRuntimeClock;
  loadAssets?: () => Promise<LoadedSubwayAssets>;
  assetBase?: string;
  audio?: SubwayAudioController;
}

export interface SubwayRuntimeHandle {
  dispatch(command: RunCommand, ancestry?: EventAncestry, audioGesture?: boolean): boolean;
  requestLine(
    args: { line?: unknown; direction?: unknown; startStation?: unknown },
    ancestry?: EventAncestry,
  ): boolean;
  setImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean;
  getSnapshot(): RunSnapshot | undefined;
  dispose(): void;
}

type Running = {
  kind: 'running';
  assets: LoadedSubwayAssets;
  lines: readonly LineDefinition[];
  state: SubwayRunState;
  plans: SubwayCuePlans;
  /** The settings last applied while the run was eligible. */
  applied: NormalizedSubwayConfig;
};
type Phase = { kind: 'loading' } | { kind: 'unavailable' } | Running | { kind: 'disposed' };

const browserClock: SubwayRuntimeClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => {
    if (typeof handle === 'number') {
      globalThis.clearTimeout(handle);
    }
  },
};

export function createSubwayRuntime(
  context: AppletRuntimeContext,
  options: SubwayRuntimeOptions = {},
): SubwayRuntimeHandle {
  const clock = options.clock ?? browserClock;
  const assetBase = options.assetBase ?? SUBWAY_ASSET_BASE;
  const loadAssets = options.loadAssets ?? (() => loadSubwayAssets(assetBase));
  let phase: Phase = { kind: 'loading' };
  /** Some surface of the applet is on screen. */
  let shown = false;
  /** The run ticks and plays: while shown, or behind another page while immersion is on. */
  let eligible = false;
  let timer: unknown;
  let autoStarted = false;
  let currentConfig: Readonly<Record<string, unknown>> = get(context.config);
  const overrides: RouteOverrides = {
    line: false,
    direction: false,
    startStation: false,
    immersion: false,
  };
  const scenes = new ScenePublisher();
  const projection = new ProjectionQueue(context);
  const audio =
    options.audio ??
    createSubwayAudio({
      loadMotion: () => loadSubwayMotion(assetBase),
      onAvailability: (available) => {
        if (phase.kind !== 'disposed' && eligible) {
          void context
            .setState('audioReady', available)
            .catch((error: unknown) => console.warn('Subway audio state failed', error));
        }
      },
    });

  function running(): Running | undefined {
    return phase.kind === 'running' ? phase : undefined;
  }

  /**
   * The one place deciding whether the run goes on. Hidden with immersion on, it keeps its wall-clock schedule
   * and its sound and only skips rendering; hidden without immersion, it pauses and catches up on return.
   */
  function updateEligible(): void {
    const next = shown || (running()?.state.immersion ?? false);
    if (eligible === next) {
      return;
    }
    eligible = next;
    audio.setVisible(next);
    if (phase.kind === 'unavailable' && eligible) {
      projection.unavailable(() => phase.kind === 'unavailable' && eligible);
    }
    if (phase.kind !== 'running') {
      return;
    }
    if (eligible) {
      dispatch({ type: 'resume' });
      syncConfig();
      autoStartIfNeeded();
    } else {
      dispatch({ type: 'pause' });
    }
  }

  function clearWake(): void {
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      timer = undefined;
    }
  }

  function scheduleWake(): void {
    clearWake();
    const run = running();
    if (!run || !eligible) {
      return;
    }
    const now = clock.now();
    const wakeAt = nextRunWake(run.state, now);
    if (wakeAt === null) {
      return;
    }
    timer = clock.setTimeout(
      () => {
        timer = undefined;
        dispatch({ type: 'tick' });
      },
      Math.max(0, wakeAt - now),
    );
  }

  function publishScene(force = false): void {
    const run = running();
    if (!run) {
      return;
    }
    const now = clock.now();
    scenes.publish({
      line: lineFor(run.lines, run.state.lineId),
      snapshot: snapshotRun(run.state, now, run.lines, run.plans),
      ride: `${run.state.generation}|${run.state.laps}`,
      config: currentConfig,
      shown,
      now,
      force,
    });
  }

  function project(
    run: Running,
    effects: readonly RunEffect[],
    allowHidden = false,
    ancestry?: EventAncestry,
  ): void {
    const settled = nextRunWake(run.state, clock.now()) === null;
    publishScene(settled);
    const state = run.state;
    projection.write({
      generation: state.generation,
      settled,
      effects,
      ancestry,
      now: () => clock.now(),
      snapshot: (now) => snapshotRun(state, now, run.lines, run.plans),
      current: (generation) =>
        phase === run && (eligible || allowHidden) && run.state.generation === generation,
      playCue: (effect) => {
        if (eligible && state.immersion) {
          void audio.playCue(effect);
        }
      },
    });
  }

  function dispatch(command: RunCommand, ancestry?: EventAncestry, audioGesture = false): boolean {
    // Pausing and switching immersion are what change eligibility, so they also apply while not eligible.
    const always = command.type === 'pause' || command.type === 'set-immersion';
    const run = running();
    if (!run || (!eligible && !always)) {
      return false;
    }
    const previousLine = run.state.lineId;
    const transition = reduceRun(run.state, command, clock.now(), run.lines, run.plans);
    run.state = transition.state;
    if (run.state.lineId !== previousLine) {
      audio.resetLine(audioGesture);
    }
    audio.transition(snapshotRun(run.state, clock.now(), run.lines, run.plans), transition.effects);
    const pending = run.state.pendingCues;
    if (pending.length) {
      const group = pending[0].id.split(':').slice(0, -1).join(':');
      audio.preload(
        pending.filter((cue) => cue.id.startsWith(`${group}:`)).map((cue) => cue.cue),
      );
    }
    scheduleWake();
    project(run, transition.effects, command.type === 'pause', ancestry);
    if (command.type === 'set-immersion') {
      updateEligible();
    }
    return true;
  }

  function autoStartIfNeeded(): boolean {
    const run = running();
    if (!run || !eligible) {
      return false;
    }
    if (run.state.active) {
      autoStarted = true;
      return true;
    }
    if (autoStarted) {
      return false;
    }
    const line = lineFor(run.lines, run.state.lineId);
    if (!stepStation(line, run.state.stationCode, run.state.direction)) {
      return false;
    }
    dispatch({ type: 'start' });
    autoStarted = run.state.active;
    return autoStarted;
  }

  function reconfigure(
    { line, direction, stationCode }: LineRequest,
    ancestry?: EventAncestry,
    audioGesture = false,
  ): boolean {
    const configure: RunCommand = { type: 'configure', lineId: line.id, direction, stationCode };
    if (!dispatch(configure, ancestry, audioGesture)) {
      return false;
    }
    autoStarted = false;
    autoStartIfNeeded();
    return true;
  }

  function requestLine(
    args: { line?: unknown; direction?: unknown; startStation?: unknown },
    ancestry?: EventAncestry,
  ): boolean {
    const run = running();
    if (!run || !eligible) {
      return false;
    }
    const request = resolveLineRequest(run.lines, run.state, args);
    if (!request) {
      return false;
    }
    // The route is saved below; until the saved settings arrive they must not undo it.
    Object.assign(overrides, { line: true, direction: true, startStation: true });
    if (!reconfigure(request, ancestry, true)) {
      return false;
    }
    context.setConfig(requestedRoute(request));
    return true;
  }

  function setImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean {
    const run = running();
    if (!run) {
      return false;
    }
    const requested = enabled ?? !run.state.immersion;
    audio.setEnabled(requested, requested);
    overrides.immersion = true;
    const done = dispatch({ type: 'set-immersion', enabled: requested }, ancestry);
    if (done) {
      context.setConfig({ immersion: requested });
    }
    return done;
  }

  function getSnapshot(): RunSnapshot | undefined {
    const run = running();
    return run ? snapshotRun(run.state, clock.now(), run.lines, run.plans) : undefined;
  }

  function syncConfig(): void {
    const run = running();
    if (!run) {
      return;
    }
    const config = normalizeSubwayConfig(currentConfig, run.lines);
    const previous = run.applied;
    if (!eligible) {
      // Paused behind another page: only switching immersion on wakes the run; the rest applies once it runs.
      if (config.immersion && !previous.immersion) {
        overrides.immersion = false;
        dispatch({ type: 'set-immersion', enabled: true });
      }
      return;
    }
    const routeChanged =
      config.line !== previous.line ||
      config.direction !== previous.direction ||
      config.startStation !== previous.startStation;
    for (const key of ['line', 'direction', 'startStation', 'immersion'] as const) {
      if (config[key] !== previous[key]) {
        overrides[key] = false;
      }
    }
    run.applied = config;
    currentConfig = config;
    audio.setAnnouncementVolume(config.announcementVolume);
    const route = routeFromConfig(run.lines, run.state, config, overrides);
    if (
      routeChanged &&
      (run.state.lineId !== route.line.id ||
        run.state.direction !== route.direction ||
        run.state.stationCode !== route.stationCode)
    ) {
      reconfigure(route);
    }
    if (config.speed !== run.state.nextMultiplier) {
      dispatch({ type: 'set-speed', multiplier: config.speed });
    }
    if (!overrides.immersion && config.immersion !== run.state.immersion) {
      dispatch({ type: 'set-immersion', enabled: config.immersion });
    }
    if (previous.announcementLanguages !== config.announcementLanguages) {
      run.plans = cuePlans(run.lines, run.assets, config);
    }
    publishScene(true);
  }

  function cuePlans(
    lines: readonly LineDefinition[],
    assets: LoadedSubwayAssets,
    config: NormalizedSubwayConfig,
  ): SubwayCuePlans {
    return buildCuePlans(lines, assets, assetBase, announcementLanguages(config.announcementLanguages));
  }

  function start(assets: LoadedSubwayAssets): void {
    const lines = normalizeSubwayLines(assets.lines);
    const config = normalizeSubwayConfig(currentConfig, lines);
    currentConfig = config;
    const run: Running = {
      kind: 'running',
      assets,
      lines,
      applied: config,
      plans: cuePlans(lines, assets, config),
      state: createRunState(lines, {
        lineId: config.line,
        stationCode: config.startStation,
        direction: config.direction,
        multiplier: config.speed,
        immersion: config.immersion,
        now: clock.now(),
      }),
    };
    phase = run;
    publishScene(true);
    audio.setAnnouncementVolume(config.announcementVolume);
    audio.setEnabled(run.state.immersion);
    audio.transition(snapshotRun(run.state, clock.now(), lines, run.plans), []);
    updateEligible();
    if (!eligible) {
      return;
    }
    syncConfig();
    if (!autoStartIfNeeded()) {
      project(run, []);
      if (run.state.pendingCues.length) {
        audio.preload(run.state.pendingCues.map((cue) => cue.cue));
      }
      scheduleWake();
    }
  }

  function dispose(): void {
    if (phase.kind === 'disposed') {
      return;
    }
    phase = { kind: 'disposed' };
    clearWake();
    unsubscribeActive();
    unsubscribeConfig();
    audio.dispose();
    scenes.clear();
  }

  const unsubscribeActive = context.active.subscribe((value) => {
    shown = value;
    updateEligible();
    if (shown) {
      publishScene(true);
    }
  });
  const unsubscribeConfig = context.config.subscribe((config) => {
    currentConfig = config;
    syncConfig();
    autoStartIfNeeded();
  });

  void loadAssets()
    .then((assets) => {
      if (phase.kind === 'loading') {
        start(assets);
      }
    })
    .catch((error: unknown) => {
      if (phase.kind === 'disposed') {
        return;
      }
      console.warn('Subway assets unavailable', error);
      phase = { kind: 'unavailable' };
      if (eligible) {
        projection.unavailable(() => phase.kind === 'unavailable' && eligible);
      }
    });

  return { dispatch, requestLine, setImmersion, getSnapshot, dispose };
}
