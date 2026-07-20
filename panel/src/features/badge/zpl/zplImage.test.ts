// Golden-string tests for zplImage.ts's pure raster helpers (P3.2 Task 1,
// Step 1). These port web/src/utils/zpl-image-text.ts's monochrome/hex
// conversion (lines 75-125) into parameterized, jsdom-only pure functions --
// no canvas involved, so every case here is an exact-input/exact-output
// synthetic bitmap.
import { bitmapToZPLHex, buildGfaCommand, convertToMonochrome } from "./zplImage";

describe("convertToMonochrome", () => {
  it("converts a 16x2 RGBA image to exact monochrome bits (row0 half-black/half-white, row1 all-white)", () => {
    const width = 16;
    const height = 2;
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Row 0: pixels 0-7 black, pixels 8-15 white.
    for (let x = 0; x < width; x++) {
      const black = x < 8;
      const value = black ? 0 : 255;
      const i = (0 * width + x) * 4;
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
    // Row 1: all white.
    for (let x = 0; x < width; x++) {
      const i = (1 * width + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }

    const mono = convertToMonochrome(rgba, width, height);
    // web/src/utils/zpl-image-text.ts:87-89 -- threshold 127, no dithering:
    // gray > 127 -> 0 (white), gray <= 127 -> 1 (black).
    expect(Array.from(mono)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, // row 0
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // row 1
    ]);
  });

  it("treats gray exactly at the 127 threshold as black, and 128 as white (no dithering)", () => {
    // gray = 0.299*r + 0.587*g + 0.114*b; r=g=b=127 -> gray=127 exactly;
    // r=g=b=128 -> gray=128 exactly.
    const rgba = new Uint8ClampedArray([
      127, 127, 127, 255, // pixel 0: gray === 127 -> black (1)
      128, 128, 128, 255, // pixel 1: gray === 128 -> white (0)
    ]);
    const mono = convertToMonochrome(rgba, 2, 1);
    expect(Array.from(mono)).toEqual([1, 0]);
  });
});

describe("bitmapToZPLHex", () => {
  it("produces the exact uncompressed hex/byte-counts for the 16x2 synthetic bitmap", () => {
    const width = 16;
    const height = 2;
    const bitmap = new Uint8Array([
      1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, // row 0 -> FF 00
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // row 1 -> 00 00
    ]);
    const result = bitmapToZPLHex(bitmap, width, height);
    expect(result).toEqual({
      hex: "FF000000",
      totalBytes: 4,
      bytesPerRow: 2,
      width: 16,
      height: 2,
    });
  });

  it("pads the last (partial) byte of an odd width with zero bits", () => {
    // width=9: byte0 covers pixelX 0-7 (all black), byte1 covers pixelX 8
    // (black, MSB of byte1) then pixelX 9-15 are out-of-range padding (0).
    const width = 9;
    const bitmap = new Uint8Array(width).fill(1);
    const result = bitmapToZPLHex(bitmap, width, 1);
    expect(result).toEqual({
      hex: "FF80",
      totalBytes: 2,
      bytesPerRow: 2,
      width: 9,
      height: 1,
    });
  });

  it("renders an all-white row as 0x00 bytes", () => {
    const bitmap = new Uint8Array(8).fill(0);
    const result = bitmapToZPLHex(bitmap, 8, 1);
    expect(result).toEqual({ hex: "00", totalBytes: 1, bytesPerRow: 1, width: 8, height: 1 });
  });

  it("renders an all-black row as 0xFF bytes", () => {
    const bitmap = new Uint8Array(8).fill(1);
    const result = bitmapToZPLHex(bitmap, 8, 1);
    expect(result).toEqual({ hex: "FF", totalBytes: 1, bytesPerRow: 1, width: 8, height: 1 });
  });
});

describe("buildGfaCommand", () => {
  it("wraps a RasterResult in the exact ^FO/^GFA/^FS block (uncompressed: both byte-count params equal totalBytes)", () => {
    // width/height ride along on RasterResult for the caller's alignment
    // math (generateZpl.rasterFieldOrigin) but never appear in the ^GFA
    // command itself -- the emitted bytes are identical with or without them.
    const zpl = buildGfaCommand(10, 20, { hex: "FF00", totalBytes: 4, bytesPerRow: 2, width: 16, height: 2 });
    expect(zpl).toBe("^FO10,20\n^GFA,4,4,2,FF00\n^FS");
  });
});
