import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// The kit resolves to the app's sources in the submodule; `@supadashboard/app` lets tests reach app internals
// (never plugin code: the UI build resolves only the kit).
const app = path.resolve('supadashboard/app/src');

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@supadashboard/kit': path.join(app, 'plugin-kit.ts'),
      '@supadashboard/app': app,
      $lib: path.join(app, 'lib'),
    },
  },
  test: {
    include: ['plugins/*/ui/src/**/*.test.ts', 'plugins/*/*.test.mjs', 'scripts/*.test.mjs'],
  },
});
