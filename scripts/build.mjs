// Builds every plugin into a staging folder `dist/<id>/`: plugin.json, the native host executable and ui/.
// Signing is a separate step (scripts/release.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { pluginConfig } from '../supadashboard/app/plugin-tools/vite-plugin.mjs';

const root = path.resolve(import.meta.dirname, '..');
const target = path.resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
const dist = path.join(root, 'dist');

execFileSync('cargo', ['build', '--release', '--workspace'], { cwd: root, stdio: 'inherit' });
fs.rmSync(dist, { recursive: true, force: true });
for (const id of fs.readdirSync(path.join(root, 'plugins'))) {
  const source = path.join(root, 'plugins', id);
  const folder = path.join(dist, id);
  const { exe } = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
  // The preset resolves from the working directory; it is also Tailwind's base, so each plugin's stylesheet
  // holds only the classes its own sources use.
  process.chdir(source);
  await build({
    configFile: false,
    logLevel: 'warn',
    ...pluginConfig({ entry: 'ui/src/index.ts', outDir: path.join(folder, 'ui') }),
  });
  fs.copyFileSync(path.join(source, 'plugin.json'), path.join(folder, 'plugin.json'));
  if (exe) {
    fs.copyFileSync(path.join(target, 'release', exe), path.join(folder, exe));
  }
  console.log(`dist/${id}`);
}
