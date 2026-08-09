import { describe, expect, it } from "vitest";
import { meetsMinimumTouchTarget } from "../../e2e/mobile-geometry";

describe("meetsMinimumTouchTarget", () => {
  it("accepts the exact 44px target and browser subpixel rounding, but rejects a genuine undersize target", () => {
    expect(meetsMinimumTouchTarget(44)).toBe(true);
    expect(meetsMinimumTouchTarget(43.99993896484375)).toBe(true);
    expect(meetsMinimumTouchTarget(43.998)).toBe(false);
  });
});
