import { LINE_CATALOGUE } from '../data/load';
import type {
  DoorSequenceApi,
  LoadedSubwayAssets,
  LoadedSubwayLine,
  RuntimeCue,
  RuntimeCueManifest,
} from './sound-types';
import { parseMotionManifest, type MotionManifest } from './motion/manifest';

type SubwayGlobals = typeof globalThis & {
  DoorSequence?: DoorSequenceApi;
};

const bundlePromises = new Map<string, Promise<LoadedSubwayAssets>>();
const scriptPromises = new Map<string, Promise<void>>();
const lineIds = LINE_CATALOGUE.map((line) => line.id);

function globals(): SubwayGlobals {
  return globalThis as SubwayGlobals;
}

/** The plugin scheme serves `assets/**` of the installed subway.sdplugin here. */
export const SUBWAY_ASSET_BASE = 'http://plugin.localhost/subway/assets/';

function normalizedBase(base = SUBWAY_ASSET_BASE): URL {
  const root = new URL(base);
  if (!root.pathname.endsWith('/')) {
    root.pathname += '/';
  }
  if (!root.href.startsWith(SUBWAY_ASSET_BASE)) {
    throw new Error(`Subway assets must stay under ${SUBWAY_ASSET_BASE}`);
  }
  return root;
}

export function resolveAssetUrl(file: string, base: string): string {
  if (
    !file ||
    file.startsWith('/') ||
    file.includes('\\') ||
    file.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe Subway asset path: ${file}`);
  }
  const root = normalizedBase(base);
  const url = new URL(file.split('/').map(encodeURIComponent).join('/'), root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
    throw new Error(`Subway asset leaves its base path: ${file}`);
  }
  return url.href;
}

const cueIndexes = new WeakMap<RuntimeCueManifest, ReadonlyMap<string, RuntimeCue>>();

/** The validated cues of a catalogue by file, built once per catalogue object. */
export function cueIndex(manifest: RuntimeCueManifest): ReadonlyMap<string, RuntimeCue> {
  const known = cueIndexes.get(manifest);
  if (known) {
    return known;
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.cues)) {
    throw new Error('Unsupported Subway cue catalogue');
  }
  const result = new Map<string, RuntimeCue>();
  for (const cue of manifest.cues) {
    if (
      !cue.file ||
      result.has(cue.file) ||
      !Number.isFinite(cue.offset) ||
      cue.offset < 0 ||
      !Number.isFinite(cue.duration) ||
      cue.duration <= 0 ||
      !Number.isFinite(cue.audible_end) ||
      cue.audible_end < 0 ||
      cue.audible_end > cue.duration ||
      !/^[a-f0-9]{64}$/i.test(cue.sha256)
    ) {
      throw new Error(`Invalid or duplicate Subway cue: ${cue.file}`);
    }
    if (!cue.gainByRole || typeof cue.gainByRole !== 'object') {
      throw new Error(`Missing Subway cue gains: ${cue.file}`);
    }
    for (const gain of Object.values(cue.gainByRole)) {
      if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 4) {
        throw new Error(`Invalid Subway cue gain: ${cue.file}`);
      }
    }
    result.set(cue.file, cue);
  }
  cueIndexes.set(manifest, result);
  return result;
}

function fetchJson<T>(url: string): Promise<T> {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Subway asset request failed (${response.status}): ${url}`);
    }
    return response.json() as Promise<T>;
  });
}

function loadScript(url: string, available: () => boolean): Promise<void> {
  if (available()) {
    return Promise.resolve();
  }
  const existing = scriptPromises.get(url);
  if (existing) {
    return existing;
  }
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Subway scripts require a browser document'));
  }
  const inDom = [...document.scripts].find((script) => script.src === url);
  if (inDom?.dataset.subwayLoaded === 'true') {
    return Promise.reject(new Error(`Subway script did not expose its API: ${url}`));
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = inDom ?? document.createElement('script');
    script.addEventListener(
      'load',
      () => {
        script.dataset.subwayLoaded = 'true';
        available() ? resolve() : reject(new Error(`Subway script did not expose its API: ${url}`));
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => reject(new Error(`Unable to load Subway script: ${url}`)),
      { once: true },
    );
    if (!inDom) {
      script.src = url;
      script.async = true;
      document.head.append(script);
    }
  }).catch((error) => {
    scriptPromises.delete(url);
    throw error;
  });
  scriptPromises.set(url, promise);
  return promise;
}

export async function loadSubwayAssets(base?: string): Promise<LoadedSubwayAssets> {
  const root = normalizedBase(base);
  const key = root.href;
  let pending = bundlePromises.get(key);
  if (!pending) {
    pending = (async () => {
      await loadScript(
        resolveAssetUrl('motion/door-sequence.js', key),
        () => !!globals().DoorSequence,
      );
      const [catalogue, ...lineFiles] = await Promise.all([
        fetchJson<RuntimeCueManifest>(resolveAssetUrl('motion/runtime-cues.json', key)),
        ...lineIds.flatMap((id) => [
          fetchJson<Record<string, unknown>>(resolveAssetUrl(`lines/${id}/line.json`, key)),
          fetchJson<Record<string, unknown>>(resolveAssetUrl(`lines/${id}/pack.json`, key)),
        ]),
      ]);
      cueIndex(catalogue);
      const lines: Record<string, LoadedSubwayLine> = {};
      lineIds.forEach((id, index) => {
        lines[id] = { line: lineFiles[index * 2], pack: lineFiles[index * 2 + 1] };
      });
      const doorSequence = globals().DoorSequence;
      if (!doorSequence) {
        throw new Error('Subway door planner is unavailable');
      }
      return { catalogue, lines: Object.freeze(lines), doorSequence };
    })().catch((error) => {
      bundlePromises.delete(key);
      throw error;
    });
    bundlePromises.set(key, pending);
  }
  return pending;
}

export interface LoadedSubwayMotion {
  manifest: MotionManifest;
  urlFor(clip: string): string;
}

export async function loadSubwayMotion(base?: string): Promise<LoadedSubwayMotion> {
  const root = normalizedBase(base).href;
  const manifest = parseMotionManifest(
    await fetchJson<unknown>(resolveAssetUrl('motion/motion.json', root)),
  );
  return {
    manifest,
    urlFor: (clip) => {
      const entry = manifest.clips[clip];
      if (!entry) {
        throw new Error(`Unknown Subway motion clip: ${clip}`);
      }
      return resolveAssetUrl(entry.file, root);
    },
  };
}
