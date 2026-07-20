// Golden-string tests for generateZpl.ts -- P3.2 Task 1, Step 1.
//
// This is a parity-first port of web/src/utils/zpl.ts's `generateZPL`
// pipeline (+ web/src/utils/zpl-image-text.ts for the raster branch). Every
// case here asserts an EXACT ZPL string.
//
// Raster-branch alignment (2026-07-20, post-P3.2): the port originally
// preserved web's limitation of dropping align/valign/rotation/^FB-wrap/
// maxLines on the raster path (reconciliation #7) -- the P3.2 printed-matrix
// run then demonstrated the user-visible cost (EN names centered via native
// ^FB, RU names left-pinned, same template), so align + valign are now
// HONORED on the raster branch too, via `rasterFieldOrigin` (^FO offsets
// computed from the raster bitmap's measured width/height -- the ^GFA bytes
// themselves never change). rotation and maxLines/^FB-wrap remain dropped on
// this branch (still-documented deviations); the tests below pin BOTH halves.
import type { RasterResult } from "./zplImage";
import {
  BARCODE_MAX_MODULE_DOTS,
  BARCODE_MIN_MODULE_DOTS,
  barcodeFieldOrigin,
  barcodeFootprintModules,
  barcodeModuleWidthDots,
  barcodeOverflows,
  escapeZplData,
  estimateBarcodeWidthDots,
  generateZpl,
  mapZPLFontToSystemFont,
  mmToDots,
  needsImageRendering,
  pointsToDots,
  rasterFieldOrigin,
  valignOffsetDots,
  type RawBadgeElement,
} from "./generateZpl";

const CONFIG_90X55_300 = { width_mm: 90, height_mm: 55, dpi: 300 };

function makeDeps(result: RasterResult) {
  return { rasterizeText: vi.fn(async () => result) };
}

describe("mmToDots / pointsToDots", () => {
  it("mmToDots rounds mm->dots at 300dpi and 203dpi (web/src/utils/zpl.ts:36-38)", () => {
    expect(mmToDots(90, 300)).toBe(1063);
    expect(mmToDots(55, 300)).toBe(650);
    expect(mmToDots(20, 203)).toBe(160);
    expect(mmToDots(20, 300)).toBe(236);
  });

  it("pointsToDots rounds pt->dots (web/src/utils/zpl.ts:43-45)", () => {
    expect(pointsToDots(12, 300)).toBe(50);
    expect(pointsToDots(10, 300)).toBe(42);
    expect(pointsToDots(12, 203)).toBe(34);
  });
});

describe("escapeZplData", () => {
  it("escapes backslash, caret, then tilde in that order, no ^FH (web/src/utils/zpl.ts:66-71)", () => {
    // Input chars: a ^ b ~ c \ d
    expect(escapeZplData("a^b~c\\d")).toBe("a\\^b\\~c\\\\d");
  });
});

describe("needsImageRendering", () => {
  it("matches Cyrillic, CJK, and Arabic text; not plain Latin (web/src/utils/zpl-image-text.ts:157-160)", () => {
    expect(needsImageRendering("Привет")).toBe(true);
    expect(needsImageRendering("你好")).toBe(true);
    expect(needsImageRendering("مرحبا")).toBe(true);
    expect(needsImageRendering("Hello")).toBe(false);
    expect(needsImageRendering("")).toBe(false);
  });
});

describe("mapZPLFontToSystemFont", () => {
  it("maps built-in ZPL font codes to system fonts (web/src/utils/zpl.ts:275-291)", () => {
    expect(mapZPLFontToSystemFont("0")).toBe("Arial");
    expect(mapZPLFontToSystemFont("D")).toBe("Arial Black");
    expect(mapZPLFontToSystemFont("F")).toBe("Courier New");
    expect(mapZPLFontToSystemFont(undefined)).toBe("Arial");
  });
});

describe("generateZpl -- header/footer", () => {
  it("emits the exact ^XA/^CI28/^PW/^LL/^PR4/^LH0,0 .. ^XZ envelope for 90x55mm@300dpi with no elements", async () => {
    const zpl = await generateZpl(CONFIG_90X55_300, [], {}, makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }));
    expect(zpl).toBe("^XA\n^CI28\n^PW1063\n^LL650\n^PR4\n^LH0,0\n^XZ\n");
  });
});

describe("valignOffsetDots", () => {
  // Extracted out of generateTextZPL's inline valign block (bot review, PR
  // #87 finding #1) SPECIFICALLY so ZplPreviewModal.tsx's Rendered-tab
  // native-text draw can apply the IDENTICAL dot math instead of
  // re-deriving it -- previously that preview drew native text at the raw
  // (unshifted) y regardless of valign, silently disagreeing with what
  // actually prints. One canonical implementation; this suite pins its
  // return value directly (the calling site's canvas draw is untestable
  // under jsdom, per this file's own documented limitation elsewhere).
  it("returns 0 when valign is unset, regardless of height", () => {
    expect(valignOffsetDots({ id: "e1", type: "text", x: 0, y: 0, height: 10 }, 12, 300)).toBe(0);
  });

  it("returns 0 when height is unset, regardless of valign (matches generateTextZPL's no-op gate)", () => {
    expect(valignOffsetDots({ id: "e1", type: "text", x: 0, y: 0, valign: "middle" }, 12, 300)).toBe(0);
  });

  it("returns 0 for valign 'top' -- the unadjusted default", () => {
    expect(valignOffsetDots({ id: "e1", type: "text", x: 0, y: 0, height: 10, valign: "top" }, 12, 300)).toBe(0);
  });

  it("returns round((heightDots - fontHeightDots)/2) for 'middle' (10mm height, 12pt, 300dpi)", () => {
    // heightDots = mmToDots(10,300) = 118; fontHeightDots = pointsToDots(12,300) = 50.
    expect(valignOffsetDots({ id: "e1", type: "text", x: 0, y: 0, height: 10, valign: "middle" }, 12, 300)).toBe(34);
  });

  it("returns heightDots - fontHeightDots for 'bottom' (10mm height, 12pt, 300dpi)", () => {
    expect(valignOffsetDots({ id: "e1", type: "text", x: 0, y: 0, height: 10, valign: "bottom" }, 12, 300)).toBe(68);
  });
});

describe("generateZpl -- text native path", () => {
  it("emits the ^FB block with center align + middle valign + 90 rotation + maxLines 2, font code 0 (web/src/utils/zpl.ts:167-181)", async () => {
    const element: RawBadgeElement = {
      id: "e1",
      type: "text",
      x: 10,
      y: 5,
      width: 40,
      height: 8,
      fontSize: 10, // <=10 -> font code "0" (web/src/utils/zpl.ts:53)
      text: "Hello",
      align: "center",
      valign: "middle",
      rotation: 90,
      maxLines: 2,
    };
    const zpl = await generateZpl(
      CONFIG_90X55_300,
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toBe(
      "^XA\n^CI28\n^PW1063\n^LL650\n^PR4\n^LH0,0\n" +
        "^FO118,85^FB472,2,0,C,0^A0R,42,42^FDHello^FS\n" +
        "^XZ\n",
    );
  });

  it("renders a plain (no-width) field without ^FB, orientation N when rotation is unset", async () => {
    const element: RawBadgeElement = {
      id: "e1",
      type: "text",
      x: 0,
      y: 0,
      fontSize: 10,
      text: "Hi",
    };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO0,0^A0N,42,42^FDHi^FS\n");
    expect(zpl).not.toContain("^FB");
  });

  it("resolves text via source-wins-when-non-empty (reuses canvasMath.resolveElementText, does not re-derive)", async () => {
    const element: RawBadgeElement = {
      id: "e1",
      type: "text",
      x: 0,
      y: 0,
      fontSize: 10,
      text: "fallback",
      source: "first_name",
    };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      { first_name: "Ada" },
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FDAda^FS");
  });
});

describe("generateZpl -- qrcode", () => {
  it("computes module size max(2, round(mmToDots(width)/30)) at 203dpi for an explicit 20mm width", async () => {
    const element: RawBadgeElement = { id: "e1", type: "qrcode", x: 5, y: 5, width: 20, text: "https://example.com" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 203 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO40,40^BQN,2,5^FDQA,https://example.com^FS\n");
  });

  it("computes module size at 300dpi for an explicit 20mm width", async () => {
    const element: RawBadgeElement = { id: "e1", type: "qrcode", x: 5, y: 5, width: 20, text: "https://example.com" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO59,59^BQN,2,8^FDQA,https://example.com^FS\n");
  });

  it("falls back to a 20mm width (web/src/utils/zpl.ts:204: `element.width || 20`) when width is omitted", async () => {
    const element: RawBadgeElement = { id: "e1", type: "qrcode", x: 5, y: 5, text: "https://example.com" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    // Same module size (8) as the explicit-20mm@300dpi case above.
    expect(zpl).toContain("^FO59,59^BQN,2,8^FDQA,https://example.com^FS\n");
  });

  it("escapes special characters in QR data", async () => {
    const element: RawBadgeElement = { id: "e1", type: "qrcode", x: 0, y: 0, text: "a^b" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FDQA,a\\^b^FS\n");
  });
});

describe("generateZpl -- barcode", () => {
  it("emits ^BCN with the default 10mm height when height is omitted (web/src/utils/zpl.ts:232)", async () => {
    const element: RawBadgeElement = { id: "e1", type: "barcode", x: 5, y: 5, text: "ABC123" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO59,59^BCN,118,Y,N,N^FDABC123^FS\n");
  });

  it("maps showCaption: false to interpretation-line argument N (panel extension, 2026-07-20 live-run request)", async () => {
    const element: RawBadgeElement = { id: "e1", type: "barcode", x: 5, y: 5, text: "ABC123", showCaption: false };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO59,59^BCN,118,N,N,N^FDABC123^FS\n");
  });

  it("keeps Y for an explicit showCaption: true -- byte-identical to the absent-field default", async () => {
    const bare: RawBadgeElement = { id: "e1", type: "barcode", x: 5, y: 5, text: "ABC123" };
    const explicit: RawBadgeElement = { ...bare, showCaption: true };
    const zplBare = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [bare],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    const zplExplicit = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [explicit],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    // Back-compat pin: every template saved before showCaption existed (the
    // field absent) and every template where the operator leaves the new
    // toggle on must produce the same bytes web/backend always printed.
    expect(zplExplicit).toBe(zplBare);
    expect(zplBare).toContain("^FO59,59^BCN,118,Y,N,N^FDABC123^FS\n");
  });
});

describe("estimateBarcodeWidthDots", () => {
  it("computes (dataLength + 2) * 11 + 13 bar-only modules at a given module width (fit-to-width: width is now a parameter, not a fixed constant)", () => {
    // "ABC123" is 6 chars: (6+2)*11+13 = 101 modules * 2 dots/module = 202.
    expect(estimateBarcodeWidthDots(6, 2)).toBe(202);
  });

  it("still returns a positive width for an empty string (start/checksum/stop overhead only)", () => {
    // (0+2)*11+13 = 35 modules * 2 dots = 70.
    expect(estimateBarcodeWidthDots(0, 2)).toBe(70);
  });
});

describe("barcodeFieldOrigin", () => {
  // dataLength=6 ("ABC123"); footprintModules(6) = (6+2)*11+13+2*10 = 121.
  it("left/absent align: x is the zone's left edge, unchanged regardless of width", () => {
    // zoneWidthDots=mmToDots(30,300)=354 -> floor(354/121)=2 -> moduleWidthDots=2 (no clamping needed).
    expect(barcodeFieldOrigin({ x: 5, width: 30 }, 300, 6)).toEqual({
      x: 59, rightJustified: false, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: false,
    });
    expect(barcodeFieldOrigin({ x: 5, align: "left" }, 300, 6)).toEqual({
      x: 59, rightJustified: false, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: false,
    });
  });

  it("right align: x is the zone's right edge (left edge + zone width), rightJustified is true", () => {
    // zoneLeftDots=mmToDots(5,300)=59, zoneWidthDots=mmToDots(30,300)=354 -> x=413.
    expect(barcodeFieldOrigin({ x: 5, width: 30, align: "right" }, 300, 6)).toEqual({
      x: 413, rightJustified: true, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: false,
    });
  });

  it("right align honors an explicit width (not just the 30mm default) -- a wider zone now computes a LARGER module width, capped at the ceiling", () => {
    // zoneWidthDots=mmToDots(50,300)=591 -> floor(591/121)=4 -> capped to BARCODE_MAX_MODULE_DOTS(3).
    // estimatedWidthDots = ((6+2)*11+13)*3 = 101*3 = 303. x is unaffected -- right align uses the zone edge, not the estimate.
    expect(barcodeFieldOrigin({ x: 5, width: 50, align: "right" }, 300, 6)).toEqual({
      x: 650, rightJustified: true, estimatedWidthDots: 303, moduleWidthDots: 3, overflows: false,
    });
  });

  it("falls back to the 30mm default zone width when width is omitted", () => {
    expect(barcodeFieldOrigin({ x: 5, align: "right" }, 300, 6)).toEqual({
      x: 413, rightJustified: true, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: false,
    });
  });

  it("treats an explicit width: 0 the same as omitted width (falls back to the 30mm default zone), matching the Go generator's <= 0 check", () => {
    expect(barcodeFieldOrigin({ x: 5, width: 0, align: "right" }, 300, 6)).toEqual({
      x: 413, rightJustified: true, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: false,
    });
  });

  it("center align: x is offset by half the zone's slack over the estimated barcode width", () => {
    // slack = zoneWidthDots(354) - estimatedWidthDots(202) = 152; offset = round(152/2) = 76 -> x=59+76=135.
    expect(barcodeFieldOrigin({ x: 5, width: 30, align: "center" }, 300, 6)).toEqual({
      x: 135, rightJustified: false, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: false,
    });
  });

  it("center align clamps to zero offset (never moves backward past the zone's left edge) when the estimate exceeds the zone width, and flags overflow", () => {
    // zoneWidthDots=mmToDots(10,300)=118 -> floor(118/121)=0 -> clamped UP to BARCODE_MIN_MODULE_DOTS(2) (readability floor).
    // estimatedWidthDots=101*2=202 -> negative slack clamps to 0. footprintModules(6)*MIN(2)=242 > 118 -> overflows.
    expect(barcodeFieldOrigin({ x: 5, width: 10, align: "center" }, 300, 6)).toEqual({
      x: 59, rightJustified: false, estimatedWidthDots: 202, moduleWidthDots: 2, overflows: true,
    });
  });
});

describe("generateZpl -- barcode alignment", () => {
  it("left/absent align is byte-identical to today's output (no ^FO third argument)", async () => {
    const element: RawBadgeElement = { id: "e1", type: "barcode", x: 5, y: 5, text: "ABC123" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO59,59^BCN,118,Y,N,N^FDABC123^FS\n");
  });

  it("right align appends ^FO's z=1 justification argument, x at the zone's right edge (default 30mm width)", async () => {
    const element: RawBadgeElement = { id: "e1", type: "barcode", x: 5, y: 5, text: "ABC123", align: "right" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO413,59,1^BCN,118,Y,N,N^FDABC123^FS\n");
  });

  it("right align honors an explicit width zone, not just the 30mm default", async () => {
    const element: RawBadgeElement = {
      id: "e1", type: "barcode", x: 5, y: 5, width: 50, text: "ABC123", align: "right",
    };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO650,59,1^BCN,118,Y,N,N^FDABC123^FS\n");
  });

  it("center align computes an x offset with no ^FO third argument", async () => {
    const element: RawBadgeElement = { id: "e1", type: "barcode", x: 5, y: 5, text: "ABC123", align: "center" };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO135,59^BCN,118,Y,N,N^FDABC123^FS\n");
  });
});

describe("generateZpl -- line and box", () => {
  it("emits ^GB with a thin fixed thickness for a line (web/src/utils/zpl.ts:245-255)", async () => {
    const element: RawBadgeElement = { id: "e1", type: "line", x: 5, y: 5, width: 30 };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO59,59^GB354,2,2^FS\n");
  });

  it("emits ^GB with width and height for a box (web/src/utils/zpl.ts:260-270)", async () => {
    const element: RawBadgeElement = { id: "e1", type: "box", x: 5, y: 5, width: 30, height: 20 };
    const zpl = await generateZpl(
      { width_mm: 90, height_mm: 55, dpi: 300 },
      [element],
      {},
      makeDeps({ hex: "", totalBytes: 0, bytesPerRow: 0 }),
    );
    expect(zpl).toContain("^FO59,59^GB354,236,2^FS\n");
  });
});

describe("generateZpl -- raster branch (aligned via rasterFieldOrigin; rotation/maxLines still dropped)", () => {
  it("routes Cyrillic text through the injected rasterizer, offsets ^FO per align/valign, and still DROPS rotation/maxLines/^FB-wrap", async () => {
    const result: RasterResult = { hex: "FF00", totalBytes: 4, bytesPerRow: 2, width: 200, height: 87 };
    const deps = makeDeps(result);
    const element: RawBadgeElement = {
      id: "e1",
      type: "text",
      x: 10,
      y: 5,
      width: 40,
      height: 8,
      fontSize: 14,
      text: "Привет",
      align: "center",
      valign: "middle",
      rotation: 90, // still dropped (documented deviation)
      maxLines: 2, // still dropped (documented deviation)
    };

    const zpl = await generateZpl({ width_mm: 90, height_mm: 55, dpi: 300 }, [element], {}, deps);

    // Mock invoked with dot-sized fontSizePx = round(fontSize/72*dpi) = round(14/72*300) = 58,
    // and the system-font fallback (no customFont set) since no non-Latin script font mapping override applies.
    expect(deps.rasterizeText).toHaveBeenCalledWith("Привет", {
      fontFamily: "Arial",
      fontSizePx: 58,
      fontWeight: "normal",
    });

    // ^FO carries the alignment offsets now:
    //   x = mmToDots(10) + round((mmToDots(40) - 200) / 2) = 118 + round((472 - 200) / 2) = 118 + 136 = 254
    //   y = mmToDots(5) + round((mmToDots(8) - 87) / 2) = 59 + round((94 - 87) / 2) = 59 + 4 = 63
    // The ^GFA payload (byte counts + hex) is byte-identical to the
    // unaligned output -- only the ^FO coordinate moves.
    expect(zpl).toBe(
      "^XA\n^CI28\n^PW1063\n^LL650\n^PR4\n^LH0,0\n" +
        "^FO254,63\n^GFA,4,4,2,FF00\n^FS\n" +
        "^XZ\n",
    );
    // Still-preserved deviations: no native font/orientation command (the
    // exact string above already proves rotation 90 changed nothing) and no
    // ^FB block ever appear for a raster-routed element.
    expect(zpl).not.toContain("^A");
    expect(zpl).not.toContain("^FB");
  });

  it("routes Latin text with a customFont through the rasterizer, applies valign middle without an align (no width offset)", async () => {
    const result: RasterResult = { hex: "AA", totalBytes: 1, bytesPerRow: 1, width: 120, height: 51 };
    const deps = makeDeps(result);
    const element: RawBadgeElement = {
      id: "e2",
      type: "text",
      x: 0,
      y: 0,
      width: 40,
      height: 8,
      fontSize: 12,
      text: "Hello",
      customFont: "ARIAL.TTF",
      bold: true,
      valign: "middle",
      rotation: 90,
      maxLines: 2,
    };

    const zpl = await generateZpl({ width_mm: 90, height_mm: 55, dpi: 203 }, [element], {}, deps);

    expect(deps.rasterizeText).toHaveBeenCalledWith("Hello", {
      fontFamily: "ARIAL.TTF",
      fontSizePx: 34, // round(12/72*203)
      fontWeight: "bold",
    });
    // No align set -> x stays put (default left) even though width is set;
    // valign middle -> y = 0 + round((mmToDots(8, 203) - 51) / 2) = round((64 - 51) / 2) = 7.
    expect(zpl).toBe(
      "^XA\n^CI28\n^PW719\n^LL440\n^PR4\n^LH0,0\n" +
        "^FO0,7\n^GFA,1,1,1,AA\n^FS\n" +
        "^XZ\n",
    );
    expect(zpl).not.toContain("^A");
    expect(zpl).not.toContain("^FB");
  });

  it("clamps overflow to the box origin: a raster wider/taller than its box keeps the unaligned ^FO", async () => {
    // Raster (200x87) exceeds both the 10mm width box (118 dots) and the
    // 4mm height box (47 dots) -- both offsets clamp at 0 so the field
    // stays pinned to the element's own x/y (the pre-alignment behavior),
    // never drifting left/up out of the box or going negative.
    const result: RasterResult = { hex: "FF00", totalBytes: 4, bytesPerRow: 2, width: 200, height: 87 };
    const deps = makeDeps(result);
    const element: RawBadgeElement = {
      id: "e3",
      type: "text",
      x: 10,
      y: 5,
      width: 10,
      height: 4,
      fontSize: 14,
      text: "Привет",
      align: "center",
      valign: "bottom",
    };

    const zpl = await generateZpl({ width_mm: 90, height_mm: 55, dpi: 300 }, [element], {}, deps);
    expect(zpl).toContain("^FO118,59\n^GFA,4,4,2,FF00\n^FS\n");
  });

  it("applies no offsets when width/height are unset -- same gates as the native branch's ^FB/valign", async () => {
    const result: RasterResult = { hex: "FF00", totalBytes: 4, bytesPerRow: 2, width: 200, height: 87 };
    const deps = makeDeps(result);
    const element: RawBadgeElement = {
      id: "e4",
      type: "text",
      x: 10,
      y: 5,
      fontSize: 14,
      text: "Привет",
      align: "center", // no width -> ignored, exactly like native ^FB
      valign: "middle", // no height -> ignored, exactly like native valign
    };

    const zpl = await generateZpl({ width_mm: 90, height_mm: 55, dpi: 300 }, [element], {}, deps);
    expect(zpl).toContain("^FO118,59\n^GFA,4,4,2,FF00\n^FS\n");
  });
});

describe("rasterFieldOrigin", () => {
  // The pure offset math shared by generateTextZPL's raster branch and
  // ZplPreviewModal's Rendered-tab composition (so preview placement can
  // never drift from print placement). Element geometry in mm, raster in
  // dots (the rasterizer's measured bitmap size), result in dots.
  const raster = { width: 100, height: 60 };

  it("center: x += round((boxWidth - rasterWidth) / 2)", () => {
    // mmToDots(40, 300) = 472; round((472 - 100) / 2) = 186.
    const origin = rasterFieldOrigin({ x: 10, y: 5, width: 40, align: "center" }, 300, raster);
    expect(origin).toEqual({ x: 118 + 186, y: 59 });
  });

  it("right: x += boxWidth - rasterWidth (full slack)", () => {
    const origin = rasterFieldOrigin({ x: 10, y: 5, width: 40, align: "right" }, 300, raster);
    expect(origin).toEqual({ x: 118 + 372, y: 59 });
  });

  it("middle/bottom valign offsets use the raster bitmap's own height", () => {
    // mmToDots(8, 300) = 94; middle: round((94 - 60) / 2) = 17; bottom: 34.
    expect(rasterFieldOrigin({ x: 10, y: 5, height: 8, valign: "middle" }, 300, raster)).toEqual({ x: 118, y: 59 + 17 });
    expect(rasterFieldOrigin({ x: 10, y: 5, height: 8, valign: "bottom" }, 300, raster)).toEqual({ x: 118, y: 59 + 34 });
  });

  it("left align / top valign / unset are all no-ops", () => {
    expect(rasterFieldOrigin({ x: 10, y: 5, width: 40, height: 8, align: "left", valign: "top" }, 300, raster)).toEqual({
      x: 118,
      y: 59,
    });
    expect(rasterFieldOrigin({ x: 10, y: 5, width: 40, height: 8 }, 300, raster)).toEqual({ x: 118, y: 59 });
  });

  it("gates mirror the native branch: align needs width, valign needs height", () => {
    expect(rasterFieldOrigin({ x: 10, y: 5, align: "center" }, 300, raster)).toEqual({ x: 118, y: 59 });
    expect(rasterFieldOrigin({ x: 10, y: 5, valign: "middle" }, 300, raster)).toEqual({ x: 118, y: 59 });
  });

  it("clamps negative slack (raster larger than its box) to 0 on both axes", () => {
    // mmToDots(5, 300) = 59 < 100 wide; mmToDots(4, 300) = 47 < 60 tall.
    const origin = rasterFieldOrigin(
      { x: 10, y: 5, width: 5, height: 4, align: "center", valign: "bottom" },
      300,
      raster,
    );
    expect(origin).toEqual({ x: 118, y: 59 });
  });
});

// Fit-to-width Code 128 (2026-07-20-badge-barcode-fit-to-width-design.md,
// Task 1): the module width is now COMPUTED from the zone and data length
// instead of assuming the printer's ^BY default is 2 -- see generateZpl.ts's
// own header comment on the ZD410 center-shift bug this fixes.
describe("barcode module width (fit-to-width)", () => {
  // footprint = (len+2)*11 + 13 + 20 ; bar-only estimate = (len+2)*11 + 13
  it("footprint includes quiet zones", () => {
    expect(barcodeFootprintModules(10)).toBe((10 + 2) * 11 + 13 + 20); // 165
  });

  it("caps a short code in a wide zone at MAX_MODULE_DOTS", () => {
    // len 10 -> footprint 165 ; zone 795 dots -> floor(795/165)=4 -> capped to 3
    expect(barcodeModuleWidthDots(10, 795)).toBe(BARCODE_MAX_MODULE_DOTS);
  });

  it("gives a medium code its exact fit width above the floor", () => {
    // len 30 -> footprint (32*11+13+20)=385 ; zone 795 -> floor(795/385)=2
    expect(barcodeModuleWidthDots(30, 795)).toBe(2);
  });

  it("clamps a long code UP to the readability floor and flags overflow", () => {
    // len 36 (UUID) -> footprint (38*11+13+20)=451 ; zone 795 -> floor(795/451)=1 -> clamps to 2
    expect(barcodeModuleWidthDots(36, 795)).toBe(BARCODE_MIN_MODULE_DOTS);
    expect(barcodeOverflows(36, 795)).toBe(true);
  });

  it("does not flag overflow for a code that fits at the floor", () => {
    expect(barcodeOverflows(30, 795)).toBe(false);
  });
});

describe("barcodeFieldOrigin emits module width and drives centering", () => {
  it("center places the barcode using the COMPUTED module width, not a fixed 2", () => {
    // barcode x=0.5mm w=99.5mm @203dpi (the 2026-07-20 saved template)
    const el = { x: 0.5, width: 99.5, align: "center" as const };
    const o = barcodeFieldOrigin(el, 203, 10);
    expect(o.moduleWidthDots).toBe(3); // capped
    // estimatedWidthDots = (10+2)*11+13 bar-modules * 3 = 145*3 = 435
    expect(o.estimatedWidthDots).toBe(145 * 3);
    // zoneLeft=mmToDots(0.5,203)=4, zoneWidth=mmToDots(99.5,203)=795
    // center x = 4 + round((795-435)/2) = 4 + 180 = 184
    expect(o.x).toBe(184);
    expect(o.rightJustified).toBe(false);
    expect(o.overflows).toBe(false);
  });

  it("left is unchanged (zone-left, module width still computed)", () => {
    const o = barcodeFieldOrigin({ x: 0.5, width: 99.5, align: "left" as const }, 203, 10);
    expect(o.x).toBe(4);
    expect(o.rightJustified).toBe(false);
    expect(o.moduleWidthDots).toBe(3);
  });

  it("right uses native z=1 at the zone right edge", () => {
    const o = barcodeFieldOrigin({ x: 0.5, width: 99.5, align: "right" as const }, 203, 10);
    expect(o.x).toBe(4 + 795);
    expect(o.rightJustified).toBe(true);
  });
});

describe("generateBarcodeZPL emits ^BY before ^BC", () => {
  it("prepends ^BY{moduleWidth} to the barcode field", async () => {
    const zpl = await generateZpl(
      { width_mm: 100, height_mm: 60, dpi: 203 },
      [{ id: "b", type: "barcode", source: "code", x: 0.5, y: 37, width: 99.5, height: 17.5, align: "center" }],
      { code: "QA-EN-0001" },
      { rasterizeText: async () => { throw new Error("no raster for barcode"); } },
    );
    // ^BY3 (capped), then ^FO at the computed center x=184
    expect(zpl).toContain("^BY3^FO184,");
    expect(zpl).toContain("^BCN,");
  });
});
