import type { StationDefinition } from '../../simulation/lines';
import type { ScreenLanguage, ScreenSchedule } from '../../rendering/screens';
import { JAPANESE_FONT } from '../../rendering/lcd/shared';

const CAR_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

export function sakaisujiOrderedStations(model: ScreenSchedule): readonly StationDefinition[] {
  const direction = model.line.directions.find((item) => item.id === model.snapshot.direction);
  return Object.freeze(
    direction?.delta === -1 ? [...model.line.stations].reverse() : [...model.line.stations],
  );
}

export function sakaisujiNearbyStations(model: ScreenSchedule): readonly StationDefinition[] {
  const ordered = sakaisujiOrderedStations(model);
  const current = ordered.findIndex((station) => station.code === model.snapshot.station);
  if (current < 0) {
    return Object.freeze([]);
  }
  const count = Math.min(6, ordered.length);
  const start = Math.max(0, Math.min(current - 1, ordered.length - count));
  return Object.freeze(ordered.slice(start, start + count));
}

export function sakaisujiCarOrder(model: ScreenSchedule): readonly number[] {
  const supplied = model.station.platformByDirection[model.snapshot.direction]?.carOrder;
  return supplied?.length === 8 ? supplied : CAR_ORDER;
}

export function fontFamily(language: ScreenLanguage): string {
  return language === 'ja' || language === 'kana' ? JAPANESE_FONT : 'Arial, sans-serif';
}

export function nameOf(station: StationDefinition, language: ScreenLanguage): string {
  return station.names[language] ?? station.names.ja ?? station.code;
}

export function displayDestination(model: ScreenSchedule): string {
  const terminal = sakaisujiOrderedStations(model).at(-1);
  if (!terminal) {
    return model.destination;
  }
  const name = nameOf(terminal, model.language);
  return `${name}${model.language === 'kana' ? 'ほうめん' : '方面'}`;
}

export function stateLabel(model: ScreenSchedule): string {
  const labels: Record<string, Partial<Record<ScreenLanguage, string>>> = {
    stopped: { ja: '停車中', kana: 'ていしゃちゅう' },
    doorsClosing: { ja: 'ドアが閉まります', kana: 'ドアがしまります' },
    departing: { ja: '発車します', kana: 'はっしゃします' },
    cruising: { ja: '次は', kana: 'つぎは' },
    approaching: { ja: 'まもなく', kana: 'まもなく' },
    arriving: { ja: '到着', kana: 'とうちゃく' },
    emergency: { ja: '緊急停止', kana: 'きんきゅうていし' },
    suspended: { ja: '運転見合わせ', kana: 'うんてんみあわせ' },
  };
  return labels[model.snapshot.state]?.[model.language] ?? labels[model.snapshot.state]?.ja ?? '';
}
