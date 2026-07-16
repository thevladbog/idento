// P3.2 Task 5 -- the REAL (browser-only) implementation of Task 1's
// injectable `RasterizeTextFn` (generateZpl.ts's `GenerateZplDeps.
// rasterizeText`). Ports web/src/utils/zpl-image-text.ts's `textToZPLImage`
// (lines 8-70): canvas create, `ctx.font = "${weight} ${sizePx}px ${family}"`,
// measureText, height = sizePx * 1.5, white background, black `fillText`
// with baseline "middle" at (0, height / 2), `getImageData` -> Task 1's pure
// `convertToMonochrome` / `bitmapToZPLHex` helpers (zplImage.ts) do the rest
// of the work (grayscale threshold + hex packing).
//
// jsdom (this repo's test environment) has NO canvas 2D context -- verified:
// no `canvas` npm package is installed here, and jsdom's own
// `HTMLCanvasElement.prototype.getContext("2d")` returns `null` without one.
// Rather than let that null propagate into a generic "Cannot read properties
// of null" crash deep inside `generateZpl`'s raster branch, this throws a
// typed, catchable error up front so callers (ZplPreviewModal) can map it to
// an honest in-modal message instead of silently leaving a tab empty. Per
// plan reconciliation #10: this file has NO pixel-output unit tests (jsdom
// can't produce real canvas pixels to assert against) -- only the throw
// itself is test-pinned, via ZplPreviewModal.test.tsx's Cyrillic-doc case.
import { bitmapToZPLHex, convertToMonochrome, type RasterResult } from "./zplImage";

export class RasterUnavailableError extends Error {
  constructor() {
    super("Canvas 2D rendering is unavailable in this environment.");
    this.name = "RasterUnavailableError";
  }
}

// web/src/utils/zpl-image-text.ts:36 -- `textHeight = fontSize * 1.5` (a
// fixed padding factor, not a real font-metrics ascent/descent measurement).
const HEIGHT_MULTIPLIER = 1.5;

/**
 * The bitmap height for a given font size in px -- web byte-parity math,
 * exported pure so the floor semantics are unit-testable under jsdom
 * (canvasRasterizer.test.ts) even though the drawing itself isn't.
 *
 * `Math.floor`, NOT `Math.round`: web assigns the fractional
 * `fontSize * 1.5` straight to `canvas.height`
 * (web/src/utils/zpl-image-text.ts:36,39), and `canvas.height` is an HTML
 * `unsigned long` IDL attribute -- the WebIDL conversion TRUNCATES the
 * fraction (floor, for positive values). Rounding up would emit a
 * one-row-taller bitmap than web's for every odd fontSizePx (different
 * ^GFA totalBytes, different hex -- a parity break, and odd sizes are
 * common: pointsToDots(8, 300) = 33).
 */
export function rasterCanvasHeight(fontSizePx: number): number {
  return Math.max(1, Math.floor(fontSizePx * HEIGHT_MULTIPLIER));
}

export interface RasterBitmap {
  bitmap: Uint8Array;
  width: number;
  height: number;
}

type RasterizeOpts = { fontFamily: string; fontSizePx: number; fontWeight: "bold" | "normal" };

// The core pixel-producing routine, synchronous (canvas 2D calls never
// yield) -- shared by the two exports below so the ZPL generation path and
// the preview modal's Rendered-tab composition draw EXACTLY the same pixels
// for the exact same (text, fontFamily, fontSizePx, fontWeight) input, never
// two independently-maintained rasterizers that could silently drift apart
// (ZplPreviewModal.tsx's own doc comment on its Rendered tab explains the
// reuse in more detail).
function rasterizeToBitmap(text: string, opts: RasterizeOpts): RasterBitmap {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RasterUnavailableError();

  const fontString = `${opts.fontWeight} ${opts.fontSizePx}px ${opts.fontFamily}`;
  ctx.font = fontString;
  const metrics = ctx.measureText(text);

  const width = Math.max(1, Math.ceil(metrics.width));
  const height = rasterCanvasHeight(opts.fontSizePx); // floor -- see rasterCanvasHeight's parity comment
  canvas.width = width;
  canvas.height = height;

  // Resizing a canvas element resets its 2D context state (font, fillStyle,
  // textBaseline all revert to the spec defaults) -- web's own
  // textToZPLImage re-sets `ctx.font` after resizing for the exact same
  // reason (zpl-image-text.ts:47).
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "black";
  ctx.font = fontString;
  ctx.textBaseline = "middle";
  // Baseline y uses the UNTRUNCATED fractional height, exactly like web:
  // there only `canvas.height` truncates (WebIDL), while `fillText`'s y is
  // computed from the fractional `textHeight` variable
  // (zpl-image-text.ts:36,53) -- using the truncated `height / 2` instead
  // would shift the glyphs a quarter-pixel for odd sizes and break pixel
  // parity even though the byte LAYOUT would still match.
  ctx.fillText(text, 0, (opts.fontSizePx * HEIGHT_MULTIPLIER) / 2);

  const imageData = ctx.getImageData(0, 0, width, height);
  const bitmap = convertToMonochrome(imageData.data, width, height);
  return { bitmap, width, height };
}

/**
 * `RasterizeTextFn` (Task 1's `generateZpl` dependency) -- wraps the sync
 * core in a Promise only because that's the shape Task 1's interface
 * declares (canvas 2D calls themselves never actually await anything).
 */
export async function rasterizeText(text: string, opts: RasterizeOpts): Promise<RasterResult> {
  const { bitmap, width, height } = rasterizeToBitmap(text, opts);
  return bitmapToZPLHex(bitmap, width, height);
}

/**
 * Reused by ZplPreviewModal's Rendered tab: the SAME pixels the ZPL output
 * embeds, before they're hex-encoded, so the on-screen composition draws the
 * true print bitmap rather than a separately-approximated rendering.
 */
export function rasterizeTextToBitmap(text: string, opts: RasterizeOpts): RasterBitmap {
  return rasterizeToBitmap(text, opts);
}
