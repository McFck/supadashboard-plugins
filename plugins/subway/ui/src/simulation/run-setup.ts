import type { LoadedSubwayAssets } from '../audio/sound-types';
import {
  announcementLanguages,
  normalizeSubwayConfig,
  type NormalizedSubwayConfig,
} from './config';
import { buildCuePlans } from './cue-plans';
import { normalizeSubwayLines, type LineDefinition } from './lines';
import { createRunState } from './run';
import type { SubwayCuePlans, SubwayRunState } from './run-state';

/** A run built from the loaded assets and the saved settings, before the runtime starts driving it. */
export interface RunSetup {
  assets: LoadedSubwayAssets;
  lines: readonly LineDefinition[];
  state: SubwayRunState;
  plans: SubwayCuePlans;
  /** The settings last applied while the run was eligible. */
  applied: NormalizedSubwayConfig;
}

export function cuePlansFor(
  setup: Pick<RunSetup, 'lines' | 'assets'>,
  assetBase: string,
  config: NormalizedSubwayConfig,
): SubwayCuePlans {
  return buildCuePlans(
    setup.lines,
    setup.assets,
    assetBase,
    announcementLanguages(config.announcementLanguages),
  );
}

/** Throws when the assets hold no usable line; the runtime then reports itself unavailable. */
export function setUpRun(
  assets: LoadedSubwayAssets,
  stored: Readonly<Record<string, unknown>>,
  assetBase: string,
  now: number,
): RunSetup {
  const lines = normalizeSubwayLines(assets.lines);
  const config = normalizeSubwayConfig(stored, lines);
  return {
    assets,
    lines,
    applied: config,
    plans: cuePlansFor({ lines, assets }, assetBase, config),
    state: createRunState(lines, {
      lineId: config.line,
      stationCode: config.startStation,
      direction: config.direction,
      multiplier: config.speed,
      immersion: config.immersion,
      now,
    }),
  };
}
