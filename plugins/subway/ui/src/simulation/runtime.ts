import { get } from 'svelte/store';
import type { AppletRuntimeContext, EventAncestry } from '@supadashboard/kit';
import { normalizeSubwayLines, stepStation, type LineDefinition } from './lines';
import { announcementLanguages, firstStationForDirection, normalizeSubwayConfig } from './config';
import { createSubwayAudio, type SubwayAudioController } from '../audio/audio';
import { loadSubwayAssets, loadSubwayMotion, SUBWAY_ASSET_BASE } from '../audio/asset-loader';
import type { LoadedSubwayAssets } from '../audio/sound-types';
import { buildCuePlans } from './cue-plans';
import { requestedRoute, resolveLineRequest } from './line-request';
import { discreteKey, eventFor, project, projectionKeys } from './projection';
import { createRunState, nextRunWake, reduceRun, snapshotRun, type RunSnapshot } from './run';
import type { RunCommand, RunEffect, SubwayCuePlans, SubwayRunState } from './run-state';
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

const browserClock: SubwayRuntimeClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

let activeRuntime: SubwayRuntimeHandle | undefined;
let activeRuntimeContext: AppletRuntimeContext | undefined;

export function createSubwayRuntime(
  context: AppletRuntimeContext,
  options: SubwayRuntimeOptions = {},
): SubwayRuntimeHandle {
  const clock = options.clock ?? browserClock;
  const loadAssets = options.loadAssets ?? (() => loadSubwayAssets(options.assetBase));
  const assetBase = options.assetBase ?? SUBWAY_ASSET_BASE;
  let alive = true;
  let ready = false;
  /** Some surface of the applet is on screen. */
  let shown = false;
  /** The run ticks and plays: while shown, or behind another page while immersion is on. */
  let eligible = false;
  const audio =
    options.audio ??
    createSubwayAudio({
      loadMotion: () => loadSubwayMotion(assetBase),
      onAvailability: (available) => {
        if (alive && eligible) void context.setState('audioReady', available).catch(() => {});
      },
    });
  let unavailable = false;
  let epoch = 0;
  let timer: unknown;
  let lines: readonly LineDefinition[] = [];
  let assets: LoadedSubwayAssets | undefined;
  let plans: SubwayCuePlans = {};
  let state: SubwayRunState | undefined;
  let autoStarted = false;
  let lastDiscreteProjection = '';
  let lastNumericProjectionAt = Number.NEGATIVE_INFINITY;
  const scenes = new ScenePublisher();
  let projectionChain = Promise.resolve();
  let currentConfig = get(context.config);
  let appliedConfig: ReturnType<typeof normalizeSubwayConfig> | undefined;
  const overrides = { line: false, direction: false, startStation: false, immersion: false };
  const unsubscribeActive = context.active.subscribe((value) => {
    shown = value;
    updateEligible();
    if (shown) publishScene(true);
  });

  /**
   * The one place deciding whether the run goes on. Hidden with immersion on, it keeps its wall-clock schedule
   * and its sound and only skips rendering; hidden without immersion, it pauses and catches up on return.
   */
  function updateEligible(): void {
    const next = shown || (state?.immersion ?? false);
    if (eligible === next) return;
    eligible = next;
    audio.setVisible(next);
    if (!alive || !ready) return;
    if (!state) {
      if (eligible && unavailable) publishUnavailable();
      return;
    }
    if (eligible) {
      dispatch({ type: 'resume' });
      syncConfig();
      autoStartIfNeeded();
    } else dispatch({ type: 'pause' });
  }

  function publishUnavailable(): void {
    const runtimeEpoch = epoch;
    projectionChain = projectionChain
      .then(async () => {
        if (!alive || runtimeEpoch !== epoch || !eligible || !unavailable) return;
        if (!Object.is(context.getState('state'), 'unavailable'))
          await context.setState('state', 'unavailable');
        if (!alive || runtimeEpoch !== epoch || !eligible || !unavailable) return;
        if (!Object.is(context.getState('paused'), true)) await context.setState('paused', true);
      })
      .catch(() => undefined);
  }

  function clearWake(): void {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  }

  function scheduleWake(): void {
    clearWake();
    if (!alive || !ready || !eligible || !state) return;
    const now = clock.now();
    const wakeAt = nextRunWake(state, now);
    if (wakeAt === null) return;
    timer = clock.setTimeout(
      () => {
        timer = undefined;
        dispatch({ type: 'tick' });
      },
      Math.max(0, wakeAt - now),
    );
  }

  function publishScene(force = false): void {
    if (!alive || !state || !lines.length) return;
    const line = lines.find((item) => item.id === state!.lineId);
    if (!line) return;
    const now = clock.now();
    scenes.publish({
      line,
      snapshot: snapshotRun(state, now, lines, plans),
      ride: `${state.generation}|${state.laps}`,
      config: currentConfig,
      shown,
      now,
      force,
    });
  }

  function queueEffects(
    effects: readonly RunEffect[],
    nextState: SubwayRunState,
    runtimeEpoch: number,
    allowHidden = false,
    ancestry?: EventAncestry,
  ): void {
    const settled = nextRunWake(nextState, clock.now()) === null;
    publishScene(settled);
    const capturedGeneration = nextState.generation;
    projectionChain = projectionChain
      .then(async () => {
        if (
          !alive ||
          runtimeEpoch !== epoch ||
          (!eligible && !allowHidden) ||
          !state ||
          state.generation !== capturedGeneration
        )
          return;
        const now = clock.now();
        const snapshot = snapshotRun(nextState, now, lines, plans);
        const values = project(snapshot);
        const discrete = discreteKey(snapshot);
        const discreteChanged = discrete !== lastDiscreteProjection;
        if (settled || discreteChanged || now - lastNumericProjectionAt >= 250) {
          lastDiscreteProjection = discrete;
          lastNumericProjectionAt = now;
          for (const key of projectionKeys) {
            if (
              !alive ||
              runtimeEpoch !== epoch ||
              (!eligible && !allowHidden) ||
              !state ||
              state.generation !== capturedGeneration
            )
              return;
            const value = values[key];
            if (Object.is(context.getState(key), value)) continue;
            await context.setState(key, value);
          }
        }
        for (const effect of effects) {
          if (
            !alive ||
            runtimeEpoch !== epoch ||
            (!eligible && !allowHidden) ||
            !state ||
            state.generation !== effect.generation
          )
            return;
          if (effect.type === 'play-cue') {
            if (eligible && nextState.immersion) void audio.playCue(effect);
            continue;
          }
          const event = eventFor(effect);
          await context.emitEvent(event.id, event.parameter, event.payload, ancestry);
        }
      })
      .catch(() => undefined);
  }

  function dispatch(command: RunCommand, ancestry?: EventAncestry, audioGesture = false): boolean {
    // Pausing and switching immersion are what change eligibility, so they also apply while not eligible.
    const always = command.type === 'pause' || command.type === 'set-immersion';
    if (!alive || !ready || (!eligible && !always) || !state || !lines.length) return false;
    const runtimeEpoch = epoch;
    const previousLine = state.lineId;
    const transition = reduceRun(state, command, clock.now(), lines, plans);
    state = transition.state;
    if (state.lineId !== previousLine) audio.resetLine(audioGesture);
    audio.transition(snapshotRun(state, clock.now(), lines, plans), transition.effects);
    if (state.pendingCues.length) {
      const group = state.pendingCues[0].id.split(':').slice(0, -1).join(':');
      audio.preload(
        state.pendingCues.filter((cue) => cue.id.startsWith(`${group}:`)).map((cue) => cue.cue),
      );
    }
    scheduleWake();
    queueEffects(transition.effects, state, runtimeEpoch, command.type === 'pause', ancestry);
    if (command.type === 'set-immersion') updateEligible();
    return true;
  }

  function autoStartIfNeeded(): boolean {
    if (!alive || !ready || !eligible || !state || !lines.length) return false;
    if (state.active) {
      autoStarted = true;
      return true;
    }
    if (autoStarted) return false;
    const line = lines.find((item) => item.id === state!.lineId);
    if (!line || !stepStation(line, state.stationCode, state.direction)) return false;
    dispatch({ type: 'start' });
    autoStarted = state.active;
    return autoStarted;
  }

  function requestLine(
    args: { line?: unknown; direction?: unknown; startStation?: unknown },
    ancestry?: EventAncestry,
  ): boolean {
    if (!alive || !ready || !eligible || !state || !lines.length) return false;
    const request = resolveLineRequest(lines, state, args);
    if (!request) return false;
    // The route is saved below; until the saved settings arrive they must not undo it.
    Object.assign(overrides, { line: true, direction: true, startStation: true });
    const { line, direction, stationCode } = request;
    if (!dispatch({ type: 'configure', lineId: line.id, direction, stationCode }, ancestry, true))
      return false;
    autoStarted = false;
    autoStartIfNeeded();
    context.setConfig(requestedRoute(request));
    return true;
  }

  function setImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean {
    if (!alive || !ready || !state) return false;
    const requested = enabled ?? !state.immersion;
    if (requested) audio.setEnabled(true, true);
    else audio.setEnabled(false);
    overrides.immersion = true;
    const done = dispatch({ type: 'set-immersion', enabled: requested }, ancestry);
    if (done) context.setConfig({ immersion: requested });
    return done;
  }

  function getSnapshot(): RunSnapshot | undefined {
    return state && lines.length ? snapshotRun(state, clock.now(), lines, plans) : undefined;
  }

  function dispose(): void {
    if (!alive) return;
    alive = false;
    epoch++;
    clearWake();
    unsubscribeActive();
    unsubscribeConfig();
    audio.dispose();
    if (activeRuntime === handle) {
      activeRuntime = undefined;
      scenes.clear();
    }
  }

  const handle: SubwayRuntimeHandle = {
    dispatch,
    requestLine,
    setImmersion,
    getSnapshot,
    dispose,
  };
  activeRuntime = handle;

  function syncConfig(): void {
    if (!alive || !ready || !state || !lines.length) return;
    const config = normalizeSubwayConfig(currentConfig, lines);
    const previous = appliedConfig;
    if (!eligible) {
      // Paused behind another page: only switching immersion on wakes the run; the rest applies once it runs.
      if (config.immersion && !previous?.immersion) {
        overrides.immersion = false;
        dispatch({ type: 'set-immersion', enabled: true });
      }
      return;
    }
    const routeChanged =
      !previous ||
      config.line !== previous.line ||
      config.direction !== previous.direction ||
      config.startStation !== previous.startStation;
    if (previous) {
      for (const key of ['line', 'direction', 'startStation', 'immersion'] as const) {
        if (config[key] !== previous[key]) overrides[key] = false;
      }
    }
    appliedConfig = config;
    currentConfig = config;
    audio.setAnnouncementVolume(config.announcementVolume);
    const targetLine = overrides.line
      ? lines.find((item) => item.id === state!.lineId)!
      : lines.find((item) => item.id === config.line)!;
    const requestedDirection = overrides.direction ? state.direction : config.direction;
    const direction = targetLine.directions.some((item) => item.id === requestedDirection)
      ? requestedDirection
      : targetLine.directions[0].id;
    const requestedStation = overrides.startStation ? state.stationCode : config.startStation;
    const stationCode = targetLine.stations.some((item) => item.code === requestedStation)
      ? requestedStation
      : firstStationForDirection(targetLine, direction);
    if (
      routeChanged &&
      (state.lineId !== targetLine.id ||
        state.direction !== direction ||
        state.stationCode !== stationCode)
    ) {
      dispatch({ type: 'configure', lineId: targetLine.id, direction, stationCode });
      autoStarted = false;
      autoStartIfNeeded();
    }
    if (config.speed !== state.nextMultiplier)
      dispatch({ type: 'set-speed', multiplier: config.speed });
    if (!overrides.immersion && config.immersion !== state.immersion)
      dispatch({ type: 'set-immersion', enabled: config.immersion });
    if (assets && previous?.announcementLanguages !== config.announcementLanguages)
      plans = buildCuePlans(
        lines,
        assets,
        assetBase,
        announcementLanguages(config.announcementLanguages),
      );
    publishScene(true);
  }

  const unsubscribeConfig = context.config.subscribe((config) => {
    currentConfig = config;
    syncConfig();
    autoStartIfNeeded();
  });

  const requestEpoch = epoch;
  void loadAssets()
    .then((loadedAssets) => {
      if (!alive || requestEpoch !== epoch) return;
      assets = loadedAssets;
      lines = normalizeSubwayLines(loadedAssets.lines);
      const config = normalizeSubwayConfig(currentConfig, lines);
      currentConfig = config;
      appliedConfig = config;
      plans = buildCuePlans(
        lines,
        loadedAssets,
        assetBase,
        announcementLanguages(config.announcementLanguages),
      );
      state = createRunState(lines, {
        lineId: config.line,
        stationCode: config.startStation,
        direction: config.direction,
        multiplier: config.speed,
        dwellSeconds: Math.max(
          0,
          typeof config.dwellSeconds === 'number' && Number.isFinite(config.dwellSeconds)
            ? config.dwellSeconds
            : 15,
        ),
        immersion: config.immersion,
        now: clock.now(),
      });
      ready = true;
      publishScene(true);
      audio.setAnnouncementVolume(config.announcementVolume);
      audio.setEnabled(state.immersion);
      audio.transition(snapshotRun(state, clock.now(), lines, plans), []);
      updateEligible();
      if (eligible) {
        syncConfig();
        if (!autoStartIfNeeded()) {
          queueEffects([], state, epoch);
          if (state.pendingCues.length) audio.preload(state.pendingCues.map((cue) => cue.cue));
          scheduleWake();
        }
      }
    })
    .catch(() => {
      if (!alive || requestEpoch !== epoch) return;
      ready = true;
      unavailable = true;
      if (eligible) publishUnavailable();
    });

  return handle;
}

export function runtime(context: AppletRuntimeContext): () => void {
  const handle = createSubwayRuntime(context);
  activeRuntimeContext = context;
  return () => {
    handle.dispose();
    if (activeRuntimeContext === context) activeRuntimeContext = undefined;
  };
}

export function dispatchSubwayCommand(command: RunCommand, ancestry?: EventAncestry): boolean {
  return activeRuntime?.dispatch(command, ancestry) ?? false;
}

export function requestSubwayLine(
  args: { line?: unknown; direction?: unknown; startStation?: unknown },
  ancestry?: EventAncestry,
): boolean {
  return activeRuntime?.requestLine(args, ancestry) ?? false;
}

export function setSubwayImmersion(enabled?: boolean, ancestry?: EventAncestry): boolean {
  return activeRuntime?.setImmersion(enabled, ancestry) ?? false;
}

export function requestSubwayView(viewId: string, ancestry?: EventAncestry): Promise<boolean> {
  if (!activeRuntimeContext || !['display', 'map', 'cab'].includes(viewId))
    return Promise.resolve(false);
  return activeRuntimeContext.setView(viewId, ancestry);
}
