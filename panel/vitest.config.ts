import react from "@vitejs/plugin-react";
import path from "node:path";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";

export default defineConfig({
  // Same vite@8-vs-vitest's-bundled-vite@5 type mismatch as web/vitest.config.ts.
  plugins: [react() as Plugin[]],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    // Vitest's default include glob (**/*.{test,spec}.*) matches the
    // Playwright e2e specs under e2e/ too (P5.3.2) -- they import test/expect
    // from @playwright/test, not vitest, and must never be collected here.
    // test.exclude REPLACES Vitest's own defaults rather than extending them,
    // so spread configDefaults.exclude to keep node_modules/dist/etc. excluded.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
