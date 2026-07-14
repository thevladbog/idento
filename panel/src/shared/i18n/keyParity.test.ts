import en from "./en.json";
import ru from "./ru.json";

// CLDR plural category suffixes that i18next resolves automatically when a
// key is used with `t(key, { count })`. Locales legitimately use different
// *subsets* of these — English has only "one"/"other", Russian has
// "one"/"few"/"many"/"other" — so a pluralized key family will have a
// different number of suffixed keys per locale file by design. Plain
// `Object.keys(en) === Object.keys(ru)` can't express that asymmetry, so
// pluralized families are compared by base name (is the family present in
// both locales?) rather than by exact suffixed key, while every
// non-pluralized key still requires an exact match.
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"] as const;

function isPluralKey(key: string): boolean {
  return PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function baseName(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s));
  return suffix ? key.slice(0, -suffix.length) : key;
}

const enKeys = Object.keys(en);
const ruKeys = Object.keys(ru);

const enPlainKeys = enKeys.filter((key) => !isPluralKey(key));
const ruPlainKeys = ruKeys.filter((key) => !isPluralKey(key));

const enPluralFamilies = new Set(enKeys.filter(isPluralKey).map(baseName));
const ruPluralFamilies = new Set(ruKeys.filter(isPluralKey).map(baseName));

describe("i18n key parity", () => {
  it("has the exact same non-pluralized keys in en.json and ru.json", () => {
    expect(ruPlainKeys.sort()).toEqual(enPlainKeys.sort());
  });

  it("has the same pluralized key families in en.json and ru.json", () => {
    // Family presence must match even though the CLDR-suffixed key counts
    // within each family don't (see comment above).
    expect([...ruPluralFamilies].sort()).toEqual([...enPluralFamilies].sort());
  });

  it("every pluralized family defines the CLDR 'other' fallback in both locales", () => {
    // i18next falls back to "<key>_other" when no more specific plural
    // category matches, so it must always be present.
    for (const family of enPluralFamilies) {
      expect(en, `en.json is missing "${family}_other"`).toHaveProperty(`${family}_other`);
      expect(ru, `ru.json is missing "${family}_other"`).toHaveProperty(`${family}_other`);
    }
  });

  it("has no empty string values", () => {
    for (const [key, value] of Object.entries({ ...en, ...ru })) {
      expect(value, `key "${key}" has an empty value`).not.toBe("");
    }
  });
});
