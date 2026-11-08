// Downloads the published catalogue and every file it lists into one folder, for a debug build of the app:
//   node scripts/pull.mjs [folder]   (default plugin-source/), then SUPADASHBOARD_PLUGIN_SOURCE=<folder>
// The app reads each file by the last segment of its catalogue URL, which is the release asset name.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'McFck/supadashboard-plugins';
const folder = path.resolve(process.argv[2] ?? 'plugin-source');
const download = (tag) =>
  execFileSync('gh', ['release', 'download', tag, '-R', REPO, '-D', folder, '--clobber'], {
    stdio: 'inherit',
  });

fs.mkdirSync(folder, { recursive: true });
download('catalogue');
const { plugins } = JSON.parse(fs.readFileSync(path.join(folder, 'catalogue.json'), 'utf8'));
const tags = new Set(
  plugins.flatMap((plugin) => plugin.files.map((file) => file.url.split('/').at(-2))),
);
for (const tag of tags) {
  download(tag);
}
console.log(`SUPADASHBOARD_PLUGIN_SOURCE=${folder}`);
