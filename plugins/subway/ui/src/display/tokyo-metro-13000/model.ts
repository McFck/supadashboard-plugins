import type { StationDefinition } from '../../simulation/lines';
import type { ScreenSchedule, ScreenLanguage } from '../../rendering/screens';
import { stationName } from './text';

const PANEL_STATIONS = 8;

export function hibiyaPanelStations(
  route: readonly StationDefinition[],
  panel: 0 | 1,
): readonly StationDefinition[] {
  return Object.freeze(route.slice(panel * PANEL_STATIONS, (panel + 1) * PANEL_STATIONS));
}

export function hibiyaRouteWindow(model: ScreenSchedule): readonly StationDefinition[] {
  const direction = model.line.directions.find((item) => item.id === model.snapshot.direction);
  const ordered =
    direction?.delta === -1 ? [...model.line.stations].reverse() : [...model.line.stations];
  const currentIndex = ordered.findIndex((station) => station.code === model.snapshot.station);
  if (currentIndex < 0) {
    return Object.freeze(model.route.slice(0, PANEL_STATIONS * 2));
  }
  const length = Math.min(PANEL_STATIONS * 2, ordered.length);
  // The reference shows three passed stops before the next stop (H06..H21, next H09).
  const start = Math.max(0, Math.min(currentIndex - 2, ordered.length - length));
  return Object.freeze(ordered.slice(start, start + length));
}

export function targetStation(model: ScreenSchedule): StationDefinition {
  return ['stopped', 'arriving', 'doorsClosing'].includes(model.snapshot.state)
    ? model.station
    : (model.nextStation ?? model.station);
}

export function destinationName(model: ScreenSchedule, language: ScreenLanguage): string {
  const direction = model.line.directions.find((d) => d.id === model.snapshot.direction);
  const station = direction?.delta === -1 ? model.line.stations[0] : model.line.stations.at(-1);
  return stationName(station ?? model.station, language);
}
