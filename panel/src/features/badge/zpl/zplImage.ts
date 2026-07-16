// Pure raster helpers for ZPL image (^GFA) generation -- P3.2 Task 1.
//
// This is a parameterized port of web/src/utils/zpl-image-text.ts's
// monochrome-conversion and hex-encoding logic (lines 75-125), split out of
// its original canvas-coupled `textToZPLImage` so it can run under jsdom
// (no canvas) here in Task 1. The actual canvas rasterizer that produces the
// `rgba`/`width`/`height` inputs is Task 5's browser-only module; this file
// only ever consumes already-rasterized pixel data.
//
// Parity note: web's bitmap is uncompressed ^GFA (no RLE), monochrome with a
// hard 127 threshold and no dithering -- this port preserves both exactly.

export interface RasterResult {
  hex: string;
  totalBytes: number;
  bytesPerRow: number;
}

/**
 * Convert RGBA pixel data to a monochrome bit array (1 = black, 0 = white).
 * Ports web/src/utils/zpl-image-text.ts:75-93 (`convertToMonochrome`), which
 * there took a canvas `ImageData` object; here the same `data`/`width`/
 * `height` fields are passed in directly so this runs without a canvas.
 */
export function convertToMonochrome(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const monochromeData = new Uint8Array(width * height);

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];

    // Convert to grayscale (web/src/utils/zpl-image-text.ts:85).
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Threshold: > 127 = white (0), <= 127 = black (1). No dithering --
    // web/src/utils/zpl-image-text.ts:87-89.
    const pixelIndex = i / 4;
    monochromeData[pixelIndex] = gray > 127 ? 0 : 1;
  }

  return monochromeData;
}

/**
 * Pack a monochrome bit array into ZPL's uncompressed ^GFA hex format: 8
 * pixels per byte, MSB-first, uppercase hex, one row's bytes concatenated
 * after the next (no row separators). Ports
 * web/src/utils/zpl-image-text.ts:98-125 (`bitmapToZPLHex`) plus the
 * byte-count math from `textToZPLImage` (lines 60-61) -- web always emits
 * BOTH ^GFA byte-count params equal to the same `totalBytes` (uncompressed;
 * no run-length "compression count" is ever less than the total), which is
 * why both fields land on the same `totalBytes` value here too.
 */
export function bitmapToZPLHex(
  bitmap: Uint8Array,
  width: number,
  height: number,
): RasterResult {
  const bytesPerRow = Math.ceil(width / 8);
  const hexData: string[] = [];

  for (let y = 0; y < height; y++) {
    let rowBytes = "";
    for (let x = 0; x < bytesPerRow; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = x * 8 + bit;
        if (pixelX < width) {
          const pixelIndex = y * width + pixelX;
          if (bitmap[pixelIndex] === 1) {
            byte |= 1 << (7 - bit);
          }
        }
      }
      rowBytes += byte.toString(16).toUpperCase().padStart(2, "0");
    }
    hexData.push(rowBytes);
  }

  const hex = hexData.join("");
  const totalBytes = bytesPerRow * height;
  return { hex, totalBytes, bytesPerRow };
}

/**
 * Wrap a RasterResult in the ^FO (position) + ^GFA (graphic field) + ^FS
 * (field separator) block. Ports web/src/utils/zpl-image-text.ts:63,143-144
 * (the `zplCommand` template plus `generateZPLWithImageText`'s ^FO/^FS
 * wrapping), now parameterized on dot coordinates instead of being computed
 * inline next to the canvas call.
 */
export function buildGfaCommand(x: number, y: number, r: RasterResult): string {
  return `^FO${x},${y}\n^GFA,${r.totalBytes},${r.totalBytes},${r.bytesPerRow},${r.hex}\n^FS`;
}
