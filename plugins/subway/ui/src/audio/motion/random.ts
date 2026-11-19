export type Random = () => number;

/** FNV-1a 32-bit over UTF-16 code units. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

export function seeded(seed: number): Random {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function between(random: Random, low: number, high: number): number {
  return low + (high - low) * random();
}

export function createPicker(size: number, random: Random, avoid = 2): () => number {
  const recent: number[] = [];
  const memory = Math.max(0, Math.min(avoid, size - 1));
  return () => {
    const open = Array.from({ length: size }, (_, index) => index).filter(
      (index) => !recent.includes(index),
    );
    const pick = open[Math.floor(random() * open.length)] ?? 0;
    recent.push(pick);
    if (recent.length > memory) recent.shift();
    return pick;
  };
}
