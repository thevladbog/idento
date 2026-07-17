// P3.2 Task 5 -- canvasRasterizer structural tests (jsdom-viable ONLY, per
// plan reconciliation #10: jsdom has no canvas 2D context, so pixel output
// is untestable here -- ZplPreviewModal.test.tsx's Cyrillic case pins the
// throw through the full generation pipeline; this file pins it at the
// module boundary plus the one piece of PURE math the rasterizer owns).
import { rasterCanvasHeight, rasterizeText, RasterUnavailableError } from "./canvasRasterizer";

describe("rasterCanvasHeight", () => {
  // Task 5 review Important 2 (web byte-parity): web assigns the fractional
  // `fontSize * 1.5` straight to `canvas.height`
  // (web/src/utils/zpl-image-text.ts:36,39) -- an `unsigned long` IDL
  // attribute, so the fraction TRUNCATES (floor). `Math.round` here would
  // produce a one-row-taller bitmap than web's for every odd fontSizePx
  // (different totalBytes, different hex -- a parity break). Odd sizes are
  // common: pointsToDots(8, 300) = 33.
  it("floors the 1.5x height for odd font sizes (web canvas.height truncation parity)", () => {
    expect(rasterCanvasHeight(33)).toBe(49); // 33 * 1.5 = 49.5 -> 49, NOT round's 50
    expect(rasterCanvasHeight(35)).toBe(52); // 52.5 -> 52
  });

  it("keeps exact values for even font sizes and never returns less than 1", () => {
    expect(rasterCanvasHeight(42)).toBe(63); // 42 * 1.5 = 63 exactly
    expect(rasterCanvasHeight(0)).toBe(1); // degenerate input still yields a drawable row
  });
});

describe("rasterizeText (jsdom structural)", () => {
  it("throws the typed RasterUnavailableError when canvas 2D is unavailable", async () => {
    // Real jsdom, no mocks: getContext("2d") is null here (no `canvas` npm
    // package installed), so the guard must throw the TYPED error callers
    // map to an honest in-modal message -- never a generic null-deref.
    await expect(
      rasterizeText("Привет", { fontFamily: "Arial", fontSizePx: 33, fontWeight: "normal" }),
    ).rejects.toBeInstanceOf(RasterUnavailableError);
  });
});
