import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

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
  },
});
