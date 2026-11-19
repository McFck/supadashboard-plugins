import { lineFactsFor } from '../data/load';
import { SUBWAY_DEFAULT_CONFIG } from '../simulation/config';
import { normalizeSubwayLine, type LineDefinition } from '../simulation/lines';
import { createRunState, snapshotRun, type RunSnapshot } from '../simulation/run';
import { e235Images } from '../display/e235/images';
import { SUBWAY_ASSET_BASE } from '../audio/asset-loader';

export interface SubwayEditorPreview {
  line: LineDefinition;
  snapshot: Readonly<RunSnapshot>;
  config: Readonly<Record<string, unknown>>;
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Subway preview asset unavailable (${response.status}): ${url}`);
  }
  return response.json();
}

function selectedLine(config: Readonly<Record<string, unknown>>): string {
  return lineFactsFor(config.line)?.id ?? SUBWAY_DEFAULT_CONFIG.line;
}

export async function loadSubwayEditorPreview(
  config: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<SubwayEditorPreview> {
  const lineId = selectedLine(config);
  const base = `${SUBWAY_ASSET_BASE}lines/${lineId}`;
  const [rawLine, rawPack] = await Promise.all([
    readJson(`${base}/line.json`, signal),
    readJson(`${base}/pack.json`, signal),
    lineId === 'yamanote' ? e235Images.acquire() : Promise.resolve(),
  ]);
  if (signal.aborted) {
    throw new DOMException('Subway preview cancelled', 'AbortError');
  }
  const line = normalizeSubwayLine(rawLine, rawPack);
  const direction =
    typeof config.direction === 'string' &&
    line.directions.some((item) => item.id === config.direction)
      ? config.direction
      : line.directions[0].id;
  const requestedStation =
    typeof config.startStation === 'string' ? config.startStation : config.station;
  const stationCode =
    typeof requestedStation === 'string' &&
    line.stations.some((item) => item.code === requestedStation)
      ? requestedStation
      : line.stations[0].code;
  const state = createRunState([line], {
    lineId,
    stationCode,
    direction,
    immersion: false,
    now: 0,
  });
  return Object.freeze({
    line,
    snapshot: Object.freeze(snapshotRun(state, 0, [line])),
    config: Object.freeze({ ...config }),
  });
}

// Nothing runs in the editor, so each view is previewed in the phase that shows it: Display at the platform,
// Map at rest on the route map, Run in motion.
const VIEW_STATES: Readonly<Record<string, RunSnapshot['state']>> = {
  display: 'approaching',
  map: 'stopped',
  cab: 'cruising',
};

export function previewForView(preview: SubwayEditorPreview, view: string): SubwayEditorPreview {
  return { ...preview, snapshot: { ...preview.snapshot, state: VIEW_STATES[view] ?? 'stopped' } };
}
