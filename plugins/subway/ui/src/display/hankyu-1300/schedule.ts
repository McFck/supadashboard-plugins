import type { RunSnapshot } from '../../simulation/run';
import {
  isScreenLanguage,
  type ScreenConfig,
  type ScreenLanguage,
  type ScreenPage,
} from '../../rendering/screens';

export function hankyuLanguages(config: ScreenConfig): ScreenLanguage[] {
  const requested = config.languages?.filter(isScreenLanguage);
  const choices: ScreenLanguage[] = requested?.length ? requested : ['ja', 'en'];
  const supports = (language: ScreenLanguage) =>
    (language === 'ja' || language === 'kana') &&
    config.line.stations.some((station) => station.names[language]);
  const present = choices.filter(supports);
  const fallback: ScreenLanguage[] = ['ja', 'kana'];
  return [...new Set(present.length ? present : fallback.filter(supports))];
}

export function hankyuCycle(
  snapshot: RunSnapshot,
  transfers: number,
): { pages: { page: ScreenPage; duration: number }[]; period: number } {
  const base =
    snapshot.state === 'stopped'
      ? [
          { page: 'platform' as const, duration: 6_000 },
          { page: 'nearby' as const, duration: 6_000 },
        ]
      : [
          { page: 'broad' as const, duration: 8_000 },
          { page: 'nearby' as const, duration: 8_000 },
        ];
  const pages =
    transfers > 0 && snapshot.state !== 'stopped'
      ? [...base, { page: 'transfers' as const, duration: 6_000 }]
      : base;
  return { pages, period: pages.reduce((sum, page) => sum + page.duration, 0) };
}
