// PR #74 review round Fix 8 -- collectMissingCustomFonts tests.
import { collectMissingCustomFonts } from "./missingFonts";
import type { RawBadgeElement } from "./generateZpl";

function textEl(id: string, customFont?: string): RawBadgeElement {
  return { id, type: "text", x: 0, y: 0, fontSize: 10, text: "Hi", customFont };
}

describe("collectMissingCustomFonts", () => {
  it("returns [] when no element has a customFont set", () => {
    expect(collectMissingCustomFonts([textEl("e1"), textEl("e2")], ["Brand Sans"])).toEqual([]);
  });

  it("returns [] when every referenced customFont is already loaded", () => {
    const elements = [textEl("e1", "Brand Sans"), textEl("e2", "Brand Serif")];
    expect(collectMissingCustomFonts(elements, ["Brand Sans", "Brand Serif"])).toEqual([]);
  });

  it("returns the family when a customFont isn't among the loaded families", () => {
    const elements = [textEl("e1", "Brand Sans")];
    expect(collectMissingCustomFonts(elements, [])).toEqual(["Brand Sans"]);
  });

  it("dedupes: the same missing family referenced by multiple elements is returned once", () => {
    const elements = [textEl("e1", "Brand Sans"), textEl("e2", "Brand Sans")];
    expect(collectMissingCustomFonts(elements, [])).toEqual(["Brand Sans"]);
  });

  it("trims whitespace before comparing, both on the element's customFont and against loaded families", () => {
    const elements = [textEl("e1", "  Brand Sans  ")];
    expect(collectMissingCustomFonts(elements, ["Brand Sans"])).toEqual([]);
  });

  it("ignores an element whose customFont is blank/whitespace-only", () => {
    const elements = [textEl("e1", "   "), textEl("e2", "")];
    expect(collectMissingCustomFonts(elements, [])).toEqual([]);
  });

  it("preserves first-appearance order and reports only the genuinely missing ones among a mix", () => {
    const elements = [
      textEl("e1", "Loaded Font"),
      textEl("e2", "Missing B"),
      textEl("e3", "Missing A"),
      textEl("e4", "Missing B"),
    ];
    expect(collectMissingCustomFonts(elements, ["Loaded Font"])).toEqual(["Missing B", "Missing A"]);
  });
});
