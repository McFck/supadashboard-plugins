// Signs and publishes the staged plugin folders in dist/ (from scripts/build.mjs).
//   node scripts/release.mjs                    signs every dist/<id> (unsigned without PLUGIN_SIGNING_KEY)
//   node scripts/release.mjs --local-catalogue  writes dist/catalogue/: catalogue.json for the staged plugins and
//                                               their files under their release asset names
//   node scripts/release.mjs --publish          CI: releases every plugin version without a tag, then rebuilds
//                                               the signed catalogue from the latest release of every plugin
// Release assets are flat (`<id>-<file>`, `ui/` becomes `ui-`); the app matches local files by that name.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = 'McFck/supadashboard-plugins';
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const tools = path.join(root, 'supadashboard/app/plugin-tools/release.mjs');

const ids = () => fs.readdirSync(path.join(root, 'plugins'));
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const tag = (id, version) => `${id}-v${version}`;
const gh = (...args) => execFileSync('gh', [...args, '-R', REPO], { encoding: 'utf8' });

function assetName(id, file) {
  return `${id}-${file.replace(/^ui\//, 'ui-')}`;
}

function filePath(id, asset) {
  const name = asset.slice(id.length + 1);
  return name.startsWith('ui-') ? `ui/${name.slice(3)}` : name;
}

/** Plugin files by path, as release.mjs allows them: bare names and ui/<name>. */
function stagedFiles(folder) {
  return fs.readdirSync(folder, { recursive: true, withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) {
      return [];
    }
    const file = path
      .relative(folder, path.join(entry.parentPath, entry.name))
      .replaceAll('\\', '/');
    if (file.startsWith('ui-')) {
      throw new Error(`${file}: a bare file name starting with ui- would clash with ui/ assets`);
    }
    return [{ path: file, bytes: fs.readFileSync(path.join(folder, file)) }];
  });
}

function entry(id, version, published, files) {
  const plugin = path.join(root, 'plugins', id);
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return {
    id,
    ...json(path.join(plugin, 'market.json')),
    version,
    api: json(path.join(plugin, 'plugin.json')).api,
    published,
    size: sorted.reduce((sum, file) => sum + file.bytes.length, 0),
    source: `https://github.com/${REPO}/tree/main/plugins/${id}`,
    guide: fs.readFileSync(path.join(plugin, 'guide.md'), 'utf8'),
    files: sorted.map((file) => ({
      path: file.path,
      url: `https://github.com/${REPO}/releases/download/${tag(id, version)}/${assetName(id, file.path)}`,
      sha256: crypto.createHash('sha256').update(file.bytes).digest('hex'),
      size: file.bytes.length,
    })),
  };
}

/** Writes catalogue.json into `folder` and signs it when the key is set. */
function writeCatalogue(folder, plugins) {
  const file = path.join(folder, 'catalogue.json');
  const catalogue = { format: 1, published: new Date().toISOString(), plugins };
  fs.writeFileSync(file, JSON.stringify(catalogue));
  if (process.env.PLUGIN_SIGNING_KEY) {
    execFileSync('node', [tools, '--catalogue', file], { stdio: 'inherit' });
  }
  return file;
}

function sign() {
  for (const id of ids()) {
    execFileSync('node', [tools, path.join(dist, id)], { stdio: 'inherit' });
  }
}

function localCatalogue() {
  const out = path.join(dist, 'catalogue');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  const plugins = ids().map((id) => {
    const files = stagedFiles(path.join(dist, id));
    for (const file of files) {
      fs.writeFileSync(path.join(out, assetName(id, file.path)), file.bytes);
    }
    const { version } = json(path.join(dist, id, 'plugin.json'));
    return entry(id, version, new Date().toISOString(), files);
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

function releaseMissing(work) {
  for (const id of ids()) {
    const folder = path.join(dist, id);
    const { version } = json(path.join(folder, 'plugin.json'));
    if (tagged(tag(id, version))) {
      continue;
    }
    if (!fs.existsSync(path.join(folder, 'release.sig'))) {
      throw new Error(`${id}: refusing to publish an unsigned release`);
    }
    const assets = stagedFiles(folder).map((file) => {
      const asset = path.join(work, assetName(id, file.path));
      fs.writeFileSync(asset, file.bytes);
      return asset;
    });
    const { title } = json(path.join(root, 'plugins', id, 'market.json'));
    const target = process.env.GITHUB_SHA ? ['--target', process.env.GITHUB_SHA] : [];
    gh(
      'release',
      'create',
      tag(id, version),
      ...assets,
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

/** The newest release of a plugin: its version and files, downloaded and hashed. */
function latest(id, releases, work) {
  const release = releases
    .filter((r) => r.tagName.startsWith(`${id}-v`))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  if (!release) {
    return [];
  }
  const folder = path.join(work, release.tagName);
  gh('release', 'download', release.tagName, '-D', folder);
  const files = fs.readdirSync(folder).map((asset) => ({
    path: filePath(id, asset),
    bytes: fs.readFileSync(path.join(folder, asset)),
  }));
  return [entry(id, release.tagName.slice(id.length + 2), release.publishedAt, files)];
}

function publish() {
  if (!process.env.PLUGIN_SIGNING_KEY) {
    throw new Error('PLUGIN_SIGNING_KEY is required to publish');
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  releaseMissing(work);
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
  if (!tagged('catalogue')) {
    gh('release', 'create', 'catalogue', '--title', 'Catalogue', '--notes', '', '--latest=false');
  }
  gh('release', 'upload', 'catalogue', file, path.join(work, 'catalogue.sig'), '--clobber');
  console.log('catalogue published');
}

const mode = process.argv[2];
if (mode === '--publish') {
  publish();
} else if (mode === '--local-catalogue') {
  localCatalogue();
} else if (!mode) {
  sign();
} else {
  throw new Error('Usage: node scripts/release.mjs [--local-catalogue | --publish]');
}
