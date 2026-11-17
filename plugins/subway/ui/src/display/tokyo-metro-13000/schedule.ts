import {
  scheduleScreen,
  type ScreenConfig,
  type ScreenLanguage,
  type ScreenSchedule,
} from '../../rendering/screens';
import type { RunSnapshot } from '../../simulation/run';

const HIBIYA_FLIP_MS = 700;

export interface HibiyaPairSchedule {
  readonly left: ScreenSchedule;
  readonly right: ScreenSchedule;
  readonly languageOffset: number;
}

// Linear motion, vertical compression and fading reproduce the tutorial's 0.7 s flip.
export function hibiyaLanguageFrame(
  languages: readonly ScreenLanguage[],
  elapsed: number,
  offset: number,
) {
  const tick = Math.floor((elapsed + 1_000) / 5_000);
  const index = (((tick + offset) % languages.length) + languages.length) % languages.length;
  const progress =
    tick === 0 ? 1 : Math.min(1, (elapsed - (tick * 5_000 - 1_000)) / HIBIYA_FLIP_MS);
  return {
    from: languages[(index - 1 + languages.length) % languages.length] ?? 'ja',
    to: languages[index] ?? 'ja',
    progress,
    animating: languages.length > 1 && progress < 1,
    deadline:
      languages.length < 2 ? null : progress < 1 ? tick * 5_000 - 300 : (tick + 1) * 5_000 - 1_000,
  };
}

export function scheduleHibiyaPair(
  snapshot: RunSnapshot,
  config: ScreenConfig,
  visibleElapsed: number,
): HibiyaPairSchedule {
  if (config.line.id !== 'hibiya') {
    throw new Error('Hibiya panel pair requires the Hibiya line');
  }
  const base = scheduleScreen(snapshot, config, visibleElapsed);
  // Incident bodies are always multilingual; headers retain the configured language cycle.
  const languages = [
    ...(['emergency', 'suspended'].includes(snapshot.state)
      ? scheduleScreen({ ...snapshot, state: 'cruising' }, config, visibleElapsed).languages
      : base.languages),
  ];
  if (languages.includes('ja') && languages.includes('en') && !languages.includes('kana')) {
    languages.splice(languages.indexOf('ja') + 1, 0, 'kana');
  }
  const languageOffset =
    (typeof config.languageOffset === 'number' && Number.isSafeInteger(config.languageOffset)
      ? config.languageOffset
      : 0) + Math.max(0, languages.indexOf('en'));
  const panel = (offset: number): ScreenSchedule => {
    const frame = hibiyaLanguageFrame(languages, visibleElapsed, offset);
    const model = scheduleScreen(
      snapshot,
      { ...config, languages: [frame.to], languageOffset: 0 },
      visibleElapsed,
    );
    const nextDeadline =
      model.pageDeadline === null
        ? frame.deadline
        : frame.deadline === null
          ? model.pageDeadline
          : Math.min(model.pageDeadline, frame.deadline);
    return Object.freeze({
      ...model,
      languages: Object.freeze(languages),
      languageDeadline: frame.deadline,
      nextDeadline,
    });
  };
  return Object.freeze({
    left: panel(languageOffset),
    right: panel(languageOffset + 1),
    languageOffset,
  });
}
