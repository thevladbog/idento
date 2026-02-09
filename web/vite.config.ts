import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"))
const version = (pkg && typeof pkg.version === "string") ? pkg.version : ""

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
