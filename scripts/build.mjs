// Builds every plugin into a staging folder `dist/<id>/`: plugin.json, ui/ and assets/ (when the plugin has them).
// Packing and signing are a separate step (scripts/release.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { pluginConfig } from '../supadashboard/app/plugin-tools/vite-plugin.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
// Authoring files kept beside the assets that nothing loads at runtime: notes, and the cue measurement table the
// local sound-pack scripts verify runtime-cues.json against (4 MB).
const AUTHORING_ONLY = new Set(['README.md', 'cues.js']);

fs.rmSync(dist, { recursive: true, force: true });
for (const id of fs.readdirSync(path.join(root, 'plugins'))) {
  const source = path.join(root, 'plugins', id);
  const folder = path.join(dist, id);
  // The preset resolves from the working directory; it is also Tailwind's base, so each plugin's stylesheet
  // holds only the classes its own sources use.
  process.chdir(source);
  await build({
    configFile: false,
    logLevel: 'warn',
    ...pluginConfig({ entry: 'ui/src/index.ts', outDir: path.join(folder, 'ui') }),
  });
  fs.copyFileSync(path.join(source, 'plugin.json'), path.join(folder, 'plugin.json'));
  if (fs.existsSync(path.join(source, 'assets'))) {
    fs.cpSync(path.join(source, 'assets'), path.join(folder, 'assets'), {
      recursive: true,
      filter: (file) => !AUTHORING_ONLY.has(path.basename(file)),
    });
  }
  console.log(`dist/${id}`);
}
