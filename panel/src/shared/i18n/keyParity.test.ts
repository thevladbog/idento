import en from "./en.json";
import ru from "./ru.json";

describe("i18n key parity", () => {
  it("has the exact same keys in en.json and ru.json", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty string values", () => {
    for (const [key, value] of Object.entries({ ...en, ...ru })) {
      expect(value, `key "${key}" has an empty value`).not.toBe("");
    }
  });
});
