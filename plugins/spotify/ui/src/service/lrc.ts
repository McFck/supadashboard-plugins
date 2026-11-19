import { MAX_LINE_LENGTH, MAX_LINES, type LyricLine } from '../lyrics';

/** `mm:ss` or `mm:ss.f{1,3}` in ms, or null. */
function timestamp(tag: string): number | null {
  const found = /^(\d+):(\d{2})(?:\.(\d{0,3}))?$/.exec(tag);
  if (!found || Number(found[2]) >= 60) {
    return null;
  }
  const fraction = found[3] ?? '';
  const millis = fraction ? Number(fraction) * 10 ** (3 - fraction.length) : 0;
  const total = Number(found[1]) * 60_000 + Number(found[2]) * 1000 + millis;
  return Number.isSafeInteger(total) ? total : null;
}

/** Timed lines of an LRC text, sorted, with the global `[offset:]` applied. Untrusted: counts and lengths are capped. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw.trim();
    const stamps: number[] = [];
    for (;;) {
      const tagged = rest.startsWith('[') ? rest.slice(1) : undefined;
      const close = tagged?.indexOf(']') ?? -1;
      if (tagged === undefined || close < 0) {
        break;
      }
      const tag = tagged.slice(0, close);
      if (tag.startsWith('offset:')) {
        const value = tag.slice('offset:'.length);
        if (/^[+-]?\d+$/.test(value)) {
          offset = Number(value);
        }
      } else {
        const stamp = timestamp(tag);
        if (stamp !== null) {
          stamps.push(stamp);
        }
      }
      rest = tagged.slice(close + 1);
    }
    for (const atMs of stamps) {
      if (lines.length >= MAX_LINES) {
        break;
      }
      lines.push({ atMs, text: [...rest.trim()].slice(0, MAX_LINE_LENGTH).join('') });
    }
  }
  for (const line of lines) {
    line.atMs = Math.max(0, line.atMs + offset);
  }
  return lines.sort((a, b) => a.atMs - b.atMs);
}
