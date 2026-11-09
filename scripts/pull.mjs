// Downloads the published catalogue-v2 and every plugin file it lists into one folder, for a debug build of the app:
//   node scripts/pull.mjs [folder]   (default plugin-source/), then SUPADASHBOARD_PLUGIN_SOURCE=<folder>
// The app reads each file by the last segment of its URL, which is the release asset name.
import { execFileSync } from 'node:child_process';
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
for (const { url } of plugins) {
  const [tag, name] = url.split('/').slice(-2);
  download(tag, name);
}
console.log(`SUPADASHBOARD_PLUGIN_SOURCE=${folder}`);
