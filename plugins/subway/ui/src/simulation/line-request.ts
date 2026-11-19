import { PAUSED_LINES } from '../data/load';
import { firstStationForDirection, type NormalizedSubwayConfig } from './config';
import type { LineDefinition } from './lines';
import { lineFor, type SubwayRunState } from './run-state';

export interface LineRequest {
  line: LineDefinition;
  direction: string;
  stationCode: string;
}

/** Route settings the run chose itself; saved settings must not undo them until edited. */
export type RouteOverrides = Record<'line' | 'direction' | 'startStation' | 'immersion', boolean>;

export function requestedRoute({ line, direction, stationCode }: LineRequest) {
  return { line: line.id, direction, startStation: stationCode };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function resolveLineRequest(
  lines: readonly LineDefinition[],
  state: SubwayRunState,
  args: { line?: unknown; direction?: unknown; startStation?: unknown },
): LineRequest | undefined {
  const currentLine = lineFor(lines, state.lineId);
  const requestedLine = text(args.line);
  const cycle = lines.filter((item) => !PAUSED_LINES.has(item.id) || item.id === currentLine.id);
  const line =
    requestedLine === undefined
      ? cycle[(cycle.findIndex((item) => item.id === currentLine.id) + 1) % cycle.length]
      : lines.find((item) => item.id === requestedLine);
  if (!line) {
    return undefined;
  }
  const requestedDirection = text(args.direction);
  const direction =
    requestedDirection ??
    (line.id === currentLine.id && line.directions.some((item) => item.id === state.direction)
      ? state.direction
      : line.directions[0].id);
  if (!line.directions.some((item) => item.id === direction)) {
    return undefined;
  }
  const requestedStation = text(args.startStation);
  const stationCode =
    requestedStation ??
    (line.id === currentLine.id && line.stations.some((item) => item.code === state.stationCode)
      ? state.stationCode
      : firstStationForDirection(line, direction));
  if (!line.stations.some((item) => item.code === stationCode)) {
    return undefined;
  }
  return { line, direction, stationCode };
}

export function routeFromConfig(
  lines: readonly LineDefinition[],
  state: SubwayRunState,
  config: NormalizedSubwayConfig,
  overrides: RouteOverrides,
): LineRequest {
  const line = lineFor(lines, overrides.line ? state.lineId : config.line);
  const requestedDirection = overrides.direction ? state.direction : config.direction;
  const direction = line.directions.some((item) => item.id === requestedDirection)
    ? requestedDirection
    : line.directions[0].id;
  const requestedStation = overrides.startStation ? state.stationCode : config.startStation;
  const stationCode = line.stations.some((item) => item.code === requestedStation)
    ? requestedStation
    : firstStationForDirection(line, direction);
  return { line, direction, stationCode };
}
