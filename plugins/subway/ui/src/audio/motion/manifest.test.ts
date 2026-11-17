import { describe, expect, it } from 'vitest';
import shipped from '../../../../assets/motion/motion.json';
import { parseMotionManifest } from './manifest';

/** A copy of the shipped manifest with one value replaced at `path`. */
function withValue(path: readonly (string | number)[], value: unknown): unknown {
  const manifest: unknown = structuredClone(shipped);
  let target = manifest;
  for (const key of path.slice(0, -1)) {
    if (typeof target !== 'object' || target === null) throw new Error(`No ${key}`);
    target = Reflect.get(target, key);
  }
  if (typeof target !== 'object' || target === null) throw new Error('No target');
  Reflect.set(target, path[path.length - 1], value);
  return manifest;
}

describe('motion manifest boundary', () => {
  it('accepts the shipped manifest with one train per line', () => {
    const manifest = parseMotionManifest(shipped);
    expect(manifest.trains.flatMap((train) => train.lines).sort()).toEqual([
      'hibiya',
      'sakaisuji',
      'yamanote',
    ]);
  });

  it.each([
    ['a clip path outside the motion clips', ['clips', 'shared/hvac', 'file'], '../x.opus'],
    ['a malformed hash', ['clips', 'shared/hvac', 'sha256'], 'abc'],
    ['a reference to an unknown clip', ['trains', 0, 'beds', 'hvac'], 'shared/missing'],
    ['an empty one-shot pool', ['trains', 0, 'pools', 'joint'], []],
    [
      'a curve that runs backwards',
      ['trains', 2, 'motor', 'carrier'],
      [
        [10, 1],
        [5, 1],
      ],
    ],
    ['an impossible car size', ['trains', 0, 'car', 'wheelbase'], -2],
    ['two trains on one line', ['trains', 1, 'lines'], ['yamanote']],
    ['a missing default rolling bed', ['trains', 0, 'sections', 'default'], 'tunnel'],
  ] as const)('rejects %s', (_name, path, value) => {
    expect(() => parseMotionManifest(withValue(path, value))).toThrow(
      /Invalid Subway motion manifest/,
    );
  });
});
