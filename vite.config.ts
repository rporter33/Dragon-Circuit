import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under a subpath (GitHub Pages) with no config change.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
