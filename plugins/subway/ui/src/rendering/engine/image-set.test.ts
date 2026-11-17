import { afterEach, expect, it, vi } from 'vitest';
import { ImageSet } from './image-set';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeImages() {
  const images: FakeImage[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 100;
    naturalHeight = 100;
    src = '';
    constructor() {
      images.push(this);
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return images;
}

const urls = { a: '/a.svg', b: '/b.svg' };

it('requests nothing until acquired, then once', async () => {
  const images = fakeImages();
  const set = new ImageSet(urls);
  expect(images).toHaveLength(0);
  const first = set.acquire();
  expect(set.acquire()).toBe(first);
  expect(images).toHaveLength(2);
  const settled = vi.fn();
  set.subscribe(settled);
  for (const image of images) {
    image.onload?.();
  }
  await first;
  expect(settled).toHaveBeenCalledTimes(2);
  expect(set.revision).toBe(2);
});

it('settles readiness when image requests never complete', async () => {
  vi.useFakeTimers();
  const images = fakeImages();
  const set = new ImageSet(urls);
  const ready = set.acquire();
  await vi.advanceTimersByTimeAsync(15_000);
  await ready;
  expect(set.revision).toBe(2);
  expect(
    images.every((image) => image.onload === null && image.onerror === null && image.src === ''),
  ).toBe(true);
});

it('settles readiness even if SVG raster inspection throws', async () => {
  const images = fakeImages();
  vi.stubGlobal('document', {
    createElement() {
      throw new Error('Canvas unavailable');
    },
  });
  const set = new ImageSet(urls, () => true);
  const ready = set.acquire();
  for (const image of images) {
    image.onload?.();
  }
  await ready;
  expect(set.revision).toBe(2);
});
