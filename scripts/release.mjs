// Packs and publishes the staged plugin folders in dist/ (from scripts/build.mjs).
//   node scripts/release.mjs                    packs every dist/<id> into dist/<id>-<version>.sdplugin, signed
//                                               when PLUGIN_SIGNING_KEY is set
//   node scripts/release.mjs --local-catalogue  writes dist/catalogue/: catalogue.json for the packed plugins and
//                                               their files under their release asset names
//   node scripts/release.mjs --publish          CI: releases every plugin version without a tag, then rebuilds the
//                                               signed catalogue-v2 from the latest release of every plugin
// A release holds one asset, `<id>-<version>.sdplugin`; the older tag `catalogue` stays frozen for old app versions.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API, newest, untar } from './release-lib.mjs';

const REPO = 'McFck/supadashboard-plugins';
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const tools = path.join(root, 'supadashboard/app/plugin-tools/release.mjs');

const ids = () => fs.readdirSync(path.join(root, 'plugins'));
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const tag = (id, version) => `${id}-v${version}`;
const gh = (...args) => execFileSync('gh', [...args, '-R', REPO], { encoding: 'utf8' });

function entry(id, published, file) {
  const bytes = fs.readFileSync(file);
  const { version, api, permissions } = JSON.parse(
    untar(bytes).get('plugin.json').toString('utf8'),
  );
  if (api !== API) {
    throw new Error(`${id}: plugin.json api is ${api}, expected ${API}`);
  }
  const plugin = path.join(root, 'plugins', id);
  return {
    id,
    ...json(path.join(plugin, 'market.json')),
    version,
    api,
    published,
    size: bytes.length,
    source: `https://github.com/${REPO}/tree/main/plugins/${id}`,
    guide: fs.readFileSync(path.join(plugin, 'guide.md'), 'utf8'),
    permissions: permissions ?? {},
    url: `https://github.com/${REPO}/releases/download/${tag(id, version)}/${path.basename(file)}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Writes catalogue.json into `folder` and signs it when the key is set. */
function writeCatalogue(folder, plugins) {
  const file = path.join(folder, 'catalogue.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ format: 2, published: new Date().toISOString(), plugins }),
  );
  if (process.env.PLUGIN_SIGNING_KEY) {
    execFileSync('node', [tools, '--catalogue', file], { stdio: 'inherit' });
  }
  return file;
}

/** Packs dist/<id> and returns the .sdplugin path. */
function pack(id) {
  const folder = path.join(dist, id);
  const { version } = json(path.join(folder, 'plugin.json'));
  const out = path.join(dist, `${id}-${version}.sdplugin`);
  execFileSync('node', [tools, folder, out], { stdio: 'inherit' });
  return out;
}

function localCatalogue() {
  const out = path.join(dist, 'catalogue');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  const plugins = ids().map((id) => {
    const file = pack(id);
    fs.copyFileSync(file, path.join(out, path.basename(file)));
    return entry(id, new Date().toISOString(), file);
  });
  console.log(writeCatalogue(out, plugins));
}

function tagged(name) {
  try {
    gh('release', 'view', name, '--json', 'tagName');
    return true;
  } catch {
    // `gh release view` fails exactly when the release does not exist.
    return false;
  }
}

function releaseMissing() {
  for (const id of ids()) {
    const file = pack(id);
    const { version } = json(path.join(dist, id, 'plugin.json'));
    if (tagged(tag(id, version))) {
      continue;
    }
    if (!untar(fs.readFileSync(file)).has('release.sig')) {
      throw new Error(`${id}: refusing to publish an unsigned release`);
    }
    const { title } = json(path.join(root, 'plugins', id, 'market.json'));
    const target = process.env.GITHUB_SHA ? ['--target', process.env.GITHUB_SHA] : [];
    gh(
      'release',
      'create',
      tag(id, version),
      file,
      '--title',
      `${title} ${version}`,
      '--notes',
      '',
      '--latest=false',
      ...target,
    );
    console.log(`released ${tag(id, version)}`);
  }
}

/** The newest v2 release of a plugin as a catalogue entry, its .sdplugin downloaded and hashed. */
function latest(id, releases, work) {
  const pick = newest(id, releases, (tagName) =>
    JSON.parse(gh('release', 'view', tagName, '--json', 'assets')).assets.map((a) => a.name),
  );
  if (!pick) {
    return [];
  }
  const folder = path.join(work, pick.release.tagName);
  gh('release', 'download', pick.release.tagName, '-p', pick.asset, '-D', folder);
  return [entry(id, pick.release.publishedAt, path.join(folder, pick.asset))];
}

function publish() {
  if (!process.env.PLUGIN_SIGNING_KEY) {
    throw new Error('PLUGIN_SIGNING_KEY is required to publish');
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  releaseMissing();
  const releases = execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      `repos/${REPO}/releases`,
      '--jq',
      '.[] | {tagName: .tag_name, publishedAt: .published_at}',
    ],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const file = writeCatalogue(
    work,
    ids().flatMap((id) => latest(id, releases, work)),
  );
  if (!tagged('catalogue-v2')) {
    gh(
      'release',
      'create',
      'catalogue-v2',
      '--title',
      'Catalogue',
      '--notes',
      '',
      '--latest=false',
    );
  }
  gh('release', 'upload', 'catalogue-v2', file, path.join(work, 'catalogue.sig'), '--clobber');
  console.log('catalogue published');
}

const mode = process.argv[2];
if (mode === '--publish') {
  publish();
} else if (mode === '--local-catalogue') {
  localCatalogue();
} else if (!mode) {
  ids().forEach(pack);
} else {
  throw new Error('Usage: node scripts/release.mjs [--local-catalogue | --publish]');
}
