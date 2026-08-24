/* global Buffer */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBundle } from "./check-bundle.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "idento-bundle-"));
  roots.push(root);
  const assets = join(root, "assets");
  mkdirSync(assets);
  return assets;
}

describe("panel bundle budget", () => {
  it("accepts one entry below both limits", () => {
    const assets = fixture();
    writeFileSync(join(assets, "index-good.js"), "export default 1");
    expect(() => checkBundle(join(assets, ".."))).not.toThrow();
  });

  it("rejects missing and ambiguous entries", () => {
    const emptyAssets = fixture();
    expect(() => checkBundle(join(emptyAssets, ".."))).toThrow(/exactly one initial JS asset/);

    const twoAssets = fixture();
    writeFileSync(join(twoAssets, "index-one.js"), "1");
    writeFileSync(join(twoAssets, "index-two.js"), "2");
    expect(() => checkBundle(join(twoAssets, ".."))).toThrow(/exactly one initial JS asset/);
  });

  it("rejects raw bytes above the limit", () => {
    const assets = fixture();
    writeFileSync(join(assets, "index-large.js"), "x".repeat(1_550_001));
    expect(() => checkBundle(join(assets, ".."))).toThrow(/raw/);
  });

  it("rejects gzip bytes above the limit while raw stays allowed", () => {
    const assets = fixture();
    let state = 0x12345678;
    const bytes = Buffer.alloc(440_000);
    for (let index = 0; index < bytes.length; index += 1) {
      state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
      bytes[index] = state >>> 24;
    }
    writeFileSync(join(assets, "index-gzip.js"), bytes);
    expect(() => checkBundle(join(assets, ".."))).toThrow(/gzip/);
  });
});
