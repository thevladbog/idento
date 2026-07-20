// Golden-string tests for generateZpl.ts -- P3.2 Task 1, Step 1.
//
// This is a parity-first port of web/src/utils/zpl.ts's `generateZPL`
// pipeline (+ web/src/utils/zpl-image-text.ts for the raster branch). Every
// case here asserts an EXACT ZPL string; the raster-branch tests additionally
// pin web's known limitation (dropping rotation/valign/^FB-wrap/maxLines when
// text routes through the image-rendering path) as a passing assertion, not
// just a comment -- deviating from that limitation would be a plan
// violation, not an improvement.
import type { RasterResult } from "./zplImage";
import {
  escapeZplData,
  generateZpl,
  mapZPLFontToSystemFont,
  mmToDots,
  needsImageRendering,
  pointsToDots,
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

describe("generateZpl -- raster branch (parity-pinned limitation)", () => {
  it("routes Cyrillic text through the injected rasterizer and DROPS rotation/valign/maxLines/^FB-wrap", async () => {
    const result: RasterResult = { hex: "FF00", totalBytes: 4, bytesPerRow: 2 };
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
      valign: "middle", // dropped by the raster branch (parity limitation)
      rotation: 90, // dropped
      maxLines: 2, // dropped
    };

    const zpl = await generateZpl({ width_mm: 90, height_mm: 55, dpi: 300 }, [element], {}, deps);

    // Mock invoked with dot-sized fontSizePx = round(fontSize/72*dpi) = round(14/72*300) = 58,
    // and the system-font fallback (no customFont set) since no non-Latin script font mapping override applies.
    expect(deps.rasterizeText).toHaveBeenCalledWith("Привет", {
      fontFamily: "Arial",
      fontSizePx: 58,
      fontWeight: "normal",
    });

    // Coordinates are plain mmToDots(x,y) -- NOT valign-adjusted (that
    // adjustment lives only in the native branch, after this branch's early
    // return -- web/src/utils/zpl.ts:111-125 vs 137-148).
    expect(zpl).toBe(
      "^XA\n^CI28\n^PW1063\n^LL650\n^PR4\n^LH0,0\n" +
        "^FO118,59\n^GFA,4,4,2,FF00\n^FS\n" +
        "^XZ\n",
    );
    // Explicit parity-limitation pins: no native font/orientation command and
    // no ^FB block ever appear for a raster-routed element.
    expect(zpl).not.toContain("^A");
    expect(zpl).not.toContain("^FB");
  });

  it("routes Latin text with a customFont through the rasterizer too, and also drops rotation/valign/maxLines", async () => {
    const result: RasterResult = { hex: "AA", totalBytes: 1, bytesPerRow: 1 };
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
    expect(zpl).toBe(
      "^XA\n^CI28\n^PW719\n^LL440\n^PR4\n^LH0,0\n" +
        "^FO0,0\n^GFA,1,1,1,AA\n^FS\n" +
        "^XZ\n",
    );
    expect(zpl).not.toContain("^A");
    expect(zpl).not.toContain("^FB");
  });
});
