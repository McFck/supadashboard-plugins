import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { pluginConfig } from '../supadashboard/app/plugin-tools/vite-plugin.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const AUTHORING_ONLY = new Set(['README.md', 'cues.js']);

fs.rmSync(dist, { recursive: true, force: true });
for (const id of fs.readdirSync(path.join(root, 'plugins'))) {
  const source = path.join(root, 'plugins', id);
  const folder = path.join(dist, id);
  // The preset and Tailwind's content base resolve from the working directory.
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
