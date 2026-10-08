import { realpathSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under a subpath (GitHub Pages) with no config change.
  base: './',
  // Per-checkout cache so several worktrees can share one node_modules.
  cacheDir: '.vite',
  server: {
    // Worktrees share one node_modules through a symlink; let the dev server read through it.
    fs: { allow: ['.', realpathSync('node_modules')] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
