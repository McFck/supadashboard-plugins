type Preset = { readonly languages: readonly string[]; readonly label: string };

/** Display presets a line file may list, in picker order. */
export const DISPLAY_PRESETS: Readonly<Record<string, Preset>> = Object.freeze({
  'ja-en': { languages: ['ja', 'en'], label: 'Japanese / English' },
  'ja-kana': { languages: ['ja', 'kana'], label: 'Japanese / kana' },
  'ja-zh': { languages: ['ja', 'zh'], label: 'Japanese / Chinese' },
  'ja-ko': { languages: ['ja', 'ko'], label: 'Japanese / Korean' },
});

export const ANNOUNCEMENT_PRESETS: Readonly<Record<string, Preset>> = Object.freeze({
  ja: { languages: ['ja'], label: 'Japanese' },
  en: { languages: ['en'], label: 'English' },
  'ja-en': { languages: ['ja', 'en'], label: 'Japanese / English' },
});

export function presetOf(
  presets: Readonly<Record<string, Preset>>,
  value: unknown,
): Preset | undefined {
  return typeof value === 'string' && Object.hasOwn(presets, value) ? presets[value] : undefined;
}
