import { expect, it } from 'vitest';
import { parseLrc } from './lrc';

it('keeps gaps, multiple stamps and the global offset while dropping bad tags', () => {
  const lines = parseLrc(
    '[ar:Artist]\n[00:03.123][00:01.2]hello\n[00:02.00]\n[00:60]bad\n[xx:12]bad\n[offset:-200]',
  );
  expect(lines).toEqual([
    { atMs: 1000, text: 'hello' },
    { atMs: 1800, text: '' },
    { atMs: 2923, text: 'hello' },
  ]);
  expect(parseLrc('[00:00.01]x\n[offset:-200]')[0].atMs).toBe(0);
});

it('bounds untrusted lyrics', () => {
  const lines = parseLrc(`[00:01]${'é'.repeat(600)}\n`.repeat(2100));
  expect(lines).toHaveLength(2000);
  expect(lines.every((line) => [...line.text].length === 500)).toBe(true);
});
