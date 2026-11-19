// node scripts/pull.mjs [folder]   (default plugin-source/), then SUPADASHBOARD_PLUGIN_SOURCE=<folder>
// The app reads each file by the last segment of its URL, which is the release asset name.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'McFck/supadashboard-plugins';
const folder = path.resolve(process.argv[2] ?? 'plugin-source');
const download = (tag, pattern) =>
  execFileSync(
    'gh',
    [
      'release',
      'download',
      tag,
      '-R',
      REPO,
      '-D',
      folder,
      '--clobber',
      ...(pattern ? ['-p', pattern] : []),
    ],
    { stdio: 'inherit' },
  );

fs.mkdirSync(folder, { recursive: true });
download('catalogue-v2');
const { plugins } = JSON.parse(fs.readFileSync(path.join(folder, 'catalogue.json'), 'utf8'));
for (const { url, sha256 } of plugins) {
  const [tag, name] = url.split('/').slice(-2);
  download(tag, name);
  const bytes = fs.readFileSync(path.join(folder, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(`${name} does not match its catalogue sha256`);
  }
}
console.log(`SUPADASHBOARD_PLUGIN_SOURCE=${folder}`);
