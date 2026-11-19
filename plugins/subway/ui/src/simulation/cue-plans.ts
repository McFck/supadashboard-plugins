import type { LoadedSubwayAssets, SegmentCuePlan } from '../audio/sound-types';
import { buildSegmentCuePlan } from '../audio/sound-pack';
import { stepStation, type LineDefinition } from './lines';
import { segmentPlanKey, type SubwayCuePlans } from './run-state';

export function buildCuePlans(
  lines: readonly LineDefinition[],
  assets: LoadedSubwayAssets,
  base: string,
  languages: readonly string[],
): SubwayCuePlans {
  const plans: Record<string, SegmentCuePlan> = {};
  for (const line of lines) {
    const bundle = assets.lines[line.id];
    if (!bundle) {
      throw new Error(`Missing Subway asset bundle: ${line.id}`);
    }
    for (const station of line.stations) {
      for (const direction of line.directions) {
        const next = stepStation(line, station.code, direction.id);
        for (const target of next ? [next, station] : [station]) {
          plans[segmentPlanKey(line.id, station.code, target.code, direction.id)] =
            buildSegmentCuePlan(
              bundle,
              station.code,
              target.code,
              direction.id,
              languages,
              target.transfers.length > 0,
              assets.catalogue,
              base,
              assets.doorSequence,
            );
        }
      }
    }
  }
  return Object.freeze(plans);
}
