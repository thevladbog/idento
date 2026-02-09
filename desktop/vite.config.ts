import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV ? "localhost" : false;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5174 }
      : undefined,
  },
  build: {
    outDir: "dist",
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari18",
    minify: !process.env.TAURI_DEV,
    sourcemap: !!process.env.TAURI_DEV,
  },
});
