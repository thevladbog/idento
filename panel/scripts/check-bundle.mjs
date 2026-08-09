/* global URL, console, process */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const RAW_LIMIT = 1_550_000;
export const GZIP_LIMIT = 430_000;

export function checkBundle(distDir = fileURLToPath(new URL("../dist/", import.meta.url))) {
  const assetsDir = join(distDir, "assets");
  const entries = readdirSync(assetsDir).filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name));
  if (entries.length !== 1) {
    throw new Error("Expected exactly one initial JS asset, found " + entries.length);
  }

  const bytes = readFileSync(join(assetsDir, entries[0]));
  const raw = bytes.byteLength;
  const gzip = gzipSync(bytes).byteLength;
  console.log("panel initial JS: raw=" + raw + " gzip=" + gzip);

  if (raw > RAW_LIMIT) throw new Error("Initial JS raw " + raw + " exceeds " + RAW_LIMIT);
  if (gzip > GZIP_LIMIT) throw new Error("Initial JS gzip " + gzip + " exceeds " + GZIP_LIMIT);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkBundle();
}
