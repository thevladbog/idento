import {
  DEFAULT_SIZE_MM, clampPosition, clampSize, elementFootprint, fitScale, isBindingUnresolved, mmToPx, pxToMm,
  resolveElementText,
} from "./canvasMath";
import type { BadgeConfig } from "./templateTypes";

const config90x55: BadgeConfig = { width_mm: 90, height_mm: 55, dpi: 300 };

describe("mmToPx / pxToMm", () => {
  it("mmToPx multiplies by scale", () => {
    expect(mmToPx(10, 4.8)).toBeCloseTo(48);
    expect(mmToPx(0, 4.8)).toBe(0);
  });

  it("pxToMm divides by scale", () => {
    expect(pxToMm(48, 4.8)).toBeCloseTo(10);
  });

  it("round-trips mm -> px -> mm for several values/scales", () => {
    for (const [mm, scale] of [[10, 4.8], [0.5, 2], [90, 4.8], [1.25, 3.3]] as const) {
      expect(pxToMm(mmToPx(mm, scale), scale)).toBeCloseTo(mm);
    }
  });
});

describe("fitScale", () => {
  it("resolves 90x55mm inside a 480x312px viewport to exactly 4.8 px/mm (board's 432x264 depiction)", () => {
    expect(fitScale(config90x55, { w: 480, h: 312 })).toBeCloseTo(4.8);
  });

  it("is limited by the narrower dimension for an extreme 200x20mm board in a modest viewport", () => {
    const extreme: BadgeConfig = { width_mm: 200, height_mm: 20, dpi: 203 };
    // width-bound: (900 - 48) / 200 = 4.26; height-bound: (500 - 48) / 20 = 22.6
    // -> width governs, well under the scale cap.
    const scale = fitScale(extreme, { w: 900, h: 500 });
    expect(scale).toBeCloseTo((900 - 48) / 200);
    expect(scale).toBeLessThan(8);
  });

  it("caps the scale so an extreme thin board in a very large viewport never blows up", () => {
    const extreme: BadgeConfig = { width_mm: 200, height_mm: 20, dpi: 203 };
    // Both dimensions would fit at >8px/mm in this oversized viewport --
    // the cap must win rather than either raw fit-ratio.
    const scale = fitScale(extreme, { w: 4000, h: 3000 });
    expect(scale).toBe(8);
  });
});

describe("clampPosition", () => {
  it("clamps a negative position to 0", () => {
    expect(clampPosition({ x: -5, y: -1, width: 10, height: 10 }, config90x55)).toEqual({ x: 0, y: 0 });
  });

  it("clamps an overflowing position to the largest value that still fits (max-fitting)", () => {
    expect(clampPosition({ x: 85, y: 50, width: 20, height: 15 }, config90x55)).toEqual({
      x: 70, // 90 - 20
      y: 40, // 55 - 15
    });
  });

  it("leaves an in-bounds position untouched", () => {
    expect(clampPosition({ x: 10, y: 10, width: 10, height: 10 }, config90x55)).toEqual({ x: 10, y: 10 });
  });

  it("treats a missing width/height as a zero-size footprint (clamps against the full board edge)", () => {
    expect(clampPosition({ x: 200, y: 5 }, config90x55)).toEqual({ x: 90, y: 5 });
  });
});

describe("clampSize", () => {
  it("clamps a size below the minimum up to minMm (default 1)", () => {
    expect(clampSize({ x: 0, y: 0, width: 0, height: -3 }, config90x55)).toEqual({ width: 1, height: 1 });
  });

  it("clamps an overflowing size to the largest value that still fits from the element's x/y", () => {
    expect(clampSize({ x: 80, y: 50, width: 50, height: 50 }, config90x55)).toEqual({
      width: 10, // 90 - 80
      height: 5, // 55 - 50
    });
  });

  it("respects a custom minMm", () => {
    expect(clampSize({ x: 0, y: 0, width: 0.2, height: 0.2 }, config90x55, 0.5)).toEqual({ width: 0.5, height: 0.5 });
  });

  it("leaves an in-bounds size untouched", () => {
    expect(clampSize({ x: 0, y: 0, width: 20, height: 15 }, config90x55)).toEqual({ width: 20, height: 15 });
  });
});

describe("elementFootprint", () => {
  it("returns the element's own explicit width/height when both are set", () => {
    expect(elementFootprint({ type: "box", width: 20, height: 10 })).toEqual({ width: 20, height: 10 });
  });

  it("falls back to the per-type default for a width/height-less element", () => {
    expect(elementFootprint({ type: "text" })).toEqual({ width: 40, height: 8 });
  });

  it("mixes an explicit dimension with the per-type default for the missing one", () => {
    expect(elementFootprint({ type: "text", width: 25 })).toEqual({ width: 25, height: 8 });
  });

  it("has a default entry for every element type", () => {
    expect(Object.keys(DEFAULT_SIZE_MM).sort()).toEqual(["barcode", "box", "line", "qrcode", "text"]);
  });
});

describe("resolveElementText", () => {
  it("prefers the bound source's data value when it resolves non-empty", () => {
    expect(resolveElementText({ source: "first_name", text: "fallback" }, { first_name: "Anna" })).toBe("Anna");
  });

  it("falls back to text when the source's data value is empty", () => {
    expect(resolveElementText({ source: "first_name", text: "fallback" }, { first_name: "" })).toBe("fallback");
  });

  it("falls back to text when the source's data value is missing entirely", () => {
    expect(resolveElementText({ source: "first_name", text: "fallback" }, {})).toBe("fallback");
  });

  it("uses text directly when there is no source", () => {
    expect(resolveElementText({ text: "Static label" }, { first_name: "Anna" })).toBe("Static label");
  });

  it("resolves to an empty string when neither source nor text is set", () => {
    expect(resolveElementText({}, {})).toBe("");
  });
});

describe("isBindingUnresolved", () => {
  it("is false for an unbound element (no source at all)", () => {
    expect(isBindingUnresolved({}, {})).toBe(false);
  });

  it("is false when the bound source resolves to a non-empty value", () => {
    expect(isBindingUnresolved({ source: "first_name" }, { first_name: "Anna" })).toBe(false);
  });

  it("is true when the bound source's data value is an empty string", () => {
    expect(isBindingUnresolved({ source: "dietary" }, { dietary: "" })).toBe(true);
  });

  it("is true when the bound source's data value is missing entirely", () => {
    expect(isBindingUnresolved({ source: "dietary" }, {})).toBe(true);
  });
});
