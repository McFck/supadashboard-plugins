import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./lines/yamanote.json');
  vi.resetModules();
});

async function loadWith(edit: (line: Record<string, unknown>) => Record<string, unknown>) {
  const real = (await import('./lines/yamanote.json')).default as Record<string, unknown>;
  vi.resetModules();
  vi.doMock('./lines/yamanote.json', () => ({ default: edit(real) }));
  return import('./load');
}

// Guards the bundled line catalogue: a bad line file must fail at import, not draw a broken display.
test.each([
  [
    'a loop map placing a station twice',
    (line: Record<string, unknown>) => {
      const map = line.loopMap as { upper: string[]; lower: string[] };
      return { ...line, loopMap: { upper: map.upper, lower: [...map.lower, map.upper[0]] } };
    },
    'loopMap must place every station exactly once',
  ],
  [
    'an unknown display preset',
    (line: Record<string, unknown>) => ({ ...line, displayLanguages: ['ja-xx'] }),
    'displayLanguages must list known display presets',
  ],
])('rejects %s', async (_name, edit, message) => {
  await expect(loadWith(edit)).rejects.toThrow(message);
});

test('accepts the bundled catalogue', async () => {
  await expect(loadWith((line) => line)).resolves.toHaveProperty('LINE_CATALOGUE');
});
