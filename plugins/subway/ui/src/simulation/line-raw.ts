import type { LocalizedNames } from './lines';

export const CODE_PATTERN = /^[A-Z]{1,3}\d{2}$/;

export type RawRecord = Record<string, unknown>;

export function record(value: unknown, label: string): RawRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as RawRecord;
}

export function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function localizedNames(value: unknown, label: string): LocalizedNames {
  const source = record(value, label);
  const names: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      continue;
    }
    const key = rawKey.toLowerCase() === 'jp' ? 'ja' : rawKey.toLowerCase();
    names[key] ??= rawValue.trim();
  }
  return Object.freeze(names);
}

export function requiredNames(value: unknown, label: string): LocalizedNames {
  const names = localizedNames(value, label);
  if (!names.ja || !names.en) {
    throw new Error(`${label} requires Japanese and English names`);
  }
  return names;
}
