import { describe, expect, it } from 'vitest';
import { PointerQueue, type PointerAction } from './pointer-queue';

function queue() {
  const sent: PointerAction['input'][] = [];
  let release = () => {};
  const pointer = new PointerQueue((action) => {
    sent.push(action.input);
    return new Promise((resolve) => {
      release = () => resolve(true);
    });
  });
  return { pointer, sent, next: () => release() };
}

describe('PointerQueue', () => {
  it('merges moves that wait behind a slow reply and keeps the click after them', async () => {
    const { pointer, sent, next } = queue();
    pointer.push(1, { kind: 'begin' });
    pointer.push(1, { kind: 'move', dx: 2000, dy: 1 });
    pointer.push(1, { kind: 'move', dx: 100, dy: 2 });
    pointer.push(1, { kind: 'click' });
    for (let reply = 0; reply < 3; reply++) {
      next();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(sent).toEqual([{ kind: 'begin' }, { kind: 'move', dx: 2048, dy: 3 }, { kind: 'click' }]);
  });

  it('cancels a held or still queued button exactly once so the page never keeps it pressed', async () => {
    for (const [pressed, queued, cancels] of [
      [true, null, 1],
      [false, 'up', 1],
      [false, 'click', 0],
    ] as const) {
      const { pointer, sent, next } = queue();
      pointer.push(1, { kind: 'begin' });
      if (queued) {
        pointer.push(1, { kind: queued });
      }
      pointer.cancel(1, pressed);
      pointer.cancel(1, false);
      for (let reply = 0; reply < 3; reply++) {
        next();
        await Promise.resolve();
        await Promise.resolve();
      }
      expect(sent).toEqual([{ kind: 'begin' }, ...Array(cancels).fill({ kind: 'cancel' })]);
    }
  });
});
