import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resources } from "./i18n";

const SRC_ROOT = dirname(fileURLToPath(import.meta.url));

function isExcluded(relPath: string): boolean {
  if (relPath === "i18n.ts" || relPath === "i18n-key-usage.test.ts") return true;
  if (/\.test\.tsx?$/.test(relPath)) return true;
  if (relPath.startsWith("test/") || relPath.includes("__tests__/")) return true;
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// Matches literal-string t() calls only -- t("key") / t('key') -- never a
// dynamic call (template string or variable, e.g. t(`tenantStatus_${s}`)):
// those have no static key name to check and are out of this test's scope
// (see the spec, Section 4). Assumes `t` is only ever bound via
// react-i18next's useTranslation() in this codebase -- true today (grepped
// during planning), and a false positive here would just be an extra,
// harmless assertion, not a missed real bug.
const LITERAL_T_CALL = /\bt\(\s*(['"])([a-zA-Z0-9_]+)\1/g;

const enKeys = new Set(Object.keys(resources.en.translation));
const ruKeys = new Set(Object.keys(resources.ru.translation));

describe("every literal t() call site resolves to a real i18n key", () => {
  const files = walk(SRC_ROOT).filter((f) => !isExcluded(relative(SRC_ROOT, f)));

  for (const file of files) {
    const relPath = relative(SRC_ROOT, file);
    const content = readFileSync(file, "utf8");
    const seenInFile = new Set<string>();
    for (const match of content.matchAll(LITERAL_T_CALL)) {
      const key = match[2];
      if (seenInFile.has(key)) continue; // one assertion per unique key per file, not per call site
      seenInFile.add(key);
      it(`${relPath}: t("${key}") resolves to a defined key`, () => {
        expect(enKeys.has(key), `"${key}" missing from resources.en.translation`).toBe(true);
        expect(ruKeys.has(key), `"${key}" missing from resources.ru.translation`).toBe(true);
      });
    }
  }
});
