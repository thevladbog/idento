import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // vitest bundles vite@5.x internally; @vitejs/plugin-react resolves against the
  // top-level vite@8.x, so react()'s Plugin type doesn't structurally match
  // vitest's UserConfig['plugins'] — narrow, typed cast instead of `any`.
  plugins: [react() as Plugin[]],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    passWithNoTests: true,
  },
});
