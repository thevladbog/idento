import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXEMPT = new Set(["theme.css", "theme.test.ts"]);
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /\brgba?\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("no hardcoded colors outside theme.css", () => {
  const files = walk(HERE).filter(
    (f) => !EXEMPT.has(f.split("/").pop()!) && /\.(ts|tsx|css)$/.test(f),
  );

  it.each(files)("%s has no hex/rgb literals", (file) => {
    const content = readFileSync(file, "utf8");
    expect(content).not.toMatch(HEX);
    expect(content).not.toMatch(RGB);
  });
});
