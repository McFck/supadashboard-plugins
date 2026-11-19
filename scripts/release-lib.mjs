// Pure helpers of scripts/release.mjs: the .sdplugin reader and the choice of a plugin's newest release.
export const API = 2;

/** Entries of a ustar archive by name (the layout plugin-tools/release.mjs writes). Throws on malformed input. */
export function untar(bytes) {
  const files = new Map();
  for (let at = 0; ;) {
    if (at + 512 > bytes.length) {
      throw new Error('tar: truncated, no end marker');
    }
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) {
      return files;
    }
    const sum = parseInt(header.toString('ascii', 148, 156), 8);
    const actual = header.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
    if (header.toString('ascii', 257, 262) !== 'ustar' || sum !== actual) {
      throw new Error('tar: bad header');
    }
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(header.toString('ascii', 124, 135), 8);
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > bytes.length) {
      throw new Error(`tar: ${name} runs past the end of the input`);
    }
    files.set(name, bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function compare(a, b) {
  return a.parts.reduce((d, p, i) => d || p - b.parts[i], 0);
}

/**
 * The newest published release of `id` (tag `<id>-v<semver>`) that has the asset `<id>-<version>.sdplugin`, as
 * {release, version, asset}. Drafts (not downloadable publicly) and releases without the asset (v1 loose assets)
 * are skipped. `assets(tagName)` lists asset names.
 */
export function newest(id, releases, assets) {
  const prefix = `${id}-v`;
  return releases
    .filter((r) => !r.draft && r.tagName.startsWith(prefix))
    .map((release) => {
      const version = release.tagName.slice(prefix.length);
      const m = SEMVER.exec(version);
      return {
        release,
        version,
        parts: m ? m.slice(1).map(Number) : null,
        asset: `${id}-${version}.sdplugin`,
      };
    })
    .filter((c) => c.parts && assets(c.release.tagName).includes(c.asset))
    .sort(compare)
    .reverse()[0];
}
