// Golden-ZPL MATRIX -- P3.2 Task 10, Step 1.
//
// This file is deliberately SEPARATE from generateZpl.test.ts: that file
// pins individual rules of the ported pipeline (mmToDots, escaping, one
// element type at a time). This file is the matrix-level, cross-feature
// fixture the plan (Task 10) and the spec (§1/§9) call for -- ONE realistic
// template (three text elements bound to first_name/last_name/company + a
// QR code bound to `code` + a line) rendered across the full {font x
// language} matrix, so a reviewer can see the SAME template's output change
// exactly where the ported rules say it should (Cyrillic/customFont ->
// raster branch; everything else -> native ^A/^FB) and nowhere else.
//
// Every expected string below is a hand-executed application of
// generateZpl.ts's real (frozen, Task-1-reviewed) rules:
//   - mmToDots(mm, dpi) = round(mm / 25.4 * dpi)
//   - pointsToDots(pt, dpi) = round(pt / 72 * dpi)
//   - needsImageRendering(text) (Cyrillic/CJK/Arabic) OR a set `customFont`
//     routes a text element through the injected rasterizer and DROPS
//     rotation/valign/^FB-wrap/maxLines (parity limitation, pinned already
//     in generateZpl.test.ts; re-demonstrated here at the template level:
//     the fixture's Latin `company` element stays NATIVE in the "native
//     font" x RU cell even though its siblings raster -- routing is
//     PER-ELEMENT, not per-template).
//   - QR module size = max(2, round(mmToDots(width, dpi) / 30)); QR/line
//     never rasterize regardless of font mode (spec: native ZPL always).
//
// Deterministic mock rasterizer (Task 10 interface note): font rendering is
// NOT available under jsdom and must never be, even accidentally, load-
// bearing for a golden test (that would make the golden flaky across
// machines/fonts). The mock below returns a fixed marker hex derived from
// its own inputs via a simple, fully-worked-by-hand hash (multiply-by-31,
// the same shape as Java's String.hashCode -- picked for exactly that
// familiarity, not any cryptographic property) so:
//   (a) the SAME (text, fontFamily, fontSizePx, fontWeight) tuple always
//       produces the SAME hex (goldens are stable across runs/machines);
//   (b) the hex is cheap to recompute by hand or by a one-line script (see
//       the values inlined below) instead of hiding behind a vitest
//       snapshot file.
import { describe, expect, it, vi } from "vitest";
import type { GenerateZplDeps } from "./generateZpl";
import { generateZpl, type RawBadgeElement } from "./generateZpl";

/** Simple, deterministic, by-hand-computable hash -- see file header. */
function markerHex(text: string, fontFamily: string, fontSizePx: number, fontWeight: string): string {
  const key = `${text}|${fontFamily}|${fontSizePx}|${fontWeight}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0");
}

/**
 * The one mock rasterizer every cell in this file shares. NEVER draws
 * anything -- it is a pure function of its call arguments, so re-running
 * this suite (any machine, any font environment, CI or local) reproduces
 * byte-identical goldens. `totalBytes`/`bytesPerRow`/`width`/`height` are all
 * simply derived from the hex's own length (4 bytes for an 8-hex-char
 * marker, one fabricated "row" of `totalBytes * 8` bits) so nothing here is
 * a second independent magic number to keep in sync by hand. None of this
 * matrix's text elements set `width`/`align`/`valign` (buildElements below),
 * so rasterFieldOrigin's alignment offset never actually fires in this file
 * -- that behavior has its own dedicated tests in generateZpl.test.ts.
 */
function makeDeterministicDeps(): GenerateZplDeps {
  return {
    rasterizeText: vi.fn(
      async (
        text: string,
        opts: { fontFamily: string; fontSizePx: number; fontWeight: "bold" | "normal" },
      ) => {
        const hex = markerHex(text, opts.fontFamily, opts.fontSizePx, opts.fontWeight);
        const totalBytes = hex.length / 2;
        return { hex, totalBytes, bytesPerRow: totalBytes, width: totalBytes * 8, height: 1 };
      },
    ),
  };
}

type FontMode = "native" | "customFont";

/**
 * The shared fixture template (spec §1/§9): three text elements bound to
 * first_name/last_name/company, a QR code bound to `code`, and a line.
 * `fontMode` toggles ONLY how the text elements pick their font -- the
 * geometry, sizes, and bindings never change across matrix cells, so any
 * difference between two cells' golden strings is attributable to the font
 * mode / language axis alone, not incidental fixture drift.
 */
function buildElements(fontMode: FontMode): RawBadgeElement[] {
  const fontFields: Partial<RawBadgeElement> =
    fontMode === "native" ? { fontFamily: "0" } : { customFont: "TestFamily" };
  return [
    { id: "e-first", type: "text", x: 5, y: 5, fontSize: 12, source: "first_name", ...fontFields },
    { id: "e-last", type: "text", x: 5, y: 15, fontSize: 12, source: "last_name", ...fontFields },
    { id: "e-company", type: "text", x: 5, y: 30, fontSize: 10, source: "company", ...fontFields },
    { id: "e-qr", type: "qrcode", x: 55, y: 5, width: 20, source: "code" },
    { id: "e-line", type: "line", x: 5, y: 45, width: 50 },
  ];
}

const DATA_EN = { first_name: "Anna", last_name: "Petrova", company: "Acme Inc", code: "BADGE-EN-01" };
const DATA_RU = { first_name: "Анна", last_name: "Петрова", company: "Acme Inc", code: "BADGE-RU-01" };

const CONFIG_300 = { width_mm: 90, height_mm: 55, dpi: 300 };
const CONFIG_203 = { width_mm: 90, height_mm: 55, dpi: 203 };
// P4.4 badge document-settings: 600dpi joins 203/300 as a selectable option
// in PropertiesPane's new document-settings section (PropertiesPane.tsx's
// DPI_OPTIONS) -- this cell proves generateZpl.ts's mm<->dots arithmetic
// (a plain mm/25.4*dpi multiply, no dpi-specific branching anywhere in the
// pipeline) is genuinely dpi-generic, not just parity-tested at the two
// values the web port originally shipped with.
const CONFIG_600 = { width_mm: 90, height_mm: 55, dpi: 600 };

const HEADER_300 = "^XA\n^CI28\n^PW1063\n^LL650\n^PR4\n^LH0,0\n";
const HEADER_203 = "^XA\n^CI28\n^PW719\n^LL440\n^PR4\n^LH0,0\n";
// widthDots = round(90/25.4*600) = round(2125.98...) = 2126;
// heightDots = round(55/25.4*600) = round(1299.21...) = 1299.
const HEADER_600 = "^XA\n^CI28\n^PW2126\n^LL1299\n^PR4\n^LH0,0\n";
const FOOTER = "^XZ\n";

describe("golden ZPL matrix -- native font \"0\" vs customFont \"TestFamily\" x RU/EN (spec §1/§9)", () => {
  it("cell 1/4 -- native font \"0\" x EN: fully native path, rasterizer never invoked", async () => {
    const deps = makeDeterministicDeps();
    const zpl = await generateZpl(CONFIG_300, buildElements("native"), DATA_EN, deps);

    expect(zpl).toBe(
      HEADER_300 +
        "^FO59,59^A0N,50,50^FDAnna^FS\n" +
        "^FO59,177^A0N,50,50^FDPetrova^FS\n" +
        "^FO59,354^A0N,42,42^FDAcme Inc^FS\n" +
        "^FO650,59^BQN,2,8^FDQA,BADGE-EN-01^FS\n" +
        "^FO59,531^GB591,2,2^FS\n" +
        FOOTER,
    );
    // Latin text + a native ZPL font code (not customFont) never needs the
    // rasterizer at all -- the honest baseline cell of the matrix.
    expect(deps.rasterizeText).not.toHaveBeenCalled();
  });

  it("cell 2/4 -- native font \"0\" x RU: Cyrillic name elements raster via the mock; Latin company stays native", async () => {
    const deps = makeDeterministicDeps();
    const zpl = await generateZpl(CONFIG_300, buildElements("native"), DATA_RU, deps);

    expect(zpl).toBe(
      HEADER_300 +
        "^FO59,59\n^GFA,4,4,4,AA5FCB93\n^FS\n" +
        "^FO59,177\n^GFA,4,4,4,CA63A8DB\n^FS\n" +
        "^FO59,354^A0N,42,42^FDAcme Inc^FS\n" +
        "^FO650,59^BQN,2,8^FDQA,BADGE-RU-01^FS\n" +
        "^FO59,531^GB591,2,2^FS\n" +
        FOOTER,
    );
    // Routing is PER-ELEMENT: only the two Cyrillic elements call the
    // rasterizer (company is Latin and font mode is "native", so it takes
    // the native ^A path exactly like cell 1 -- same string, same element).
    expect(deps.rasterizeText).toHaveBeenCalledTimes(2);
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(1, "Анна", {
      fontFamily: "Arial", // mapZPLFontToSystemFont("0")
      fontSizePx: 50, // pointsToDots(12, 300)
      fontWeight: "normal",
    });
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(2, "Петрова", {
      fontFamily: "Arial",
      fontSizePx: 50,
      fontWeight: "normal",
    });
  });

  it("cell 3/4 -- customFont \"TestFamily\" x EN: ALL text elements raster despite Latin text", async () => {
    const deps = makeDeterministicDeps();
    const zpl = await generateZpl(CONFIG_300, buildElements("customFont"), DATA_EN, deps);

    expect(zpl).toBe(
      HEADER_300 +
        "^FO59,59\n^GFA,4,4,4,0693D35E\n^FS\n" +
        "^FO59,177\n^GFA,4,4,4,56287D57\n^FS\n" +
        "^FO59,354\n^GFA,4,4,4,990A6BE3\n^FS\n" +
        "^FO650,59^BQN,2,8^FDQA,BADGE-EN-01^FS\n" +
        "^FO59,531^GB591,2,2^FS\n" +
        FOOTER,
    );
    // A set customFont forces the raster branch regardless of script --
    // the exact opposite reason from cell 2, same observable effect.
    expect(deps.rasterizeText).toHaveBeenCalledTimes(3);
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(1, "Anna", {
      fontFamily: "TestFamily",
      fontSizePx: 50,
      fontWeight: "normal",
    });
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(2, "Petrova", {
      fontFamily: "TestFamily",
      fontSizePx: 50,
      fontWeight: "normal",
    });
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(3, "Acme Inc", {
      fontFamily: "TestFamily",
      fontSizePx: 42, // pointsToDots(10, 300)
      fontWeight: "normal",
    });
  });

  it("cell 4/4 -- customFont \"TestFamily\" x RU: ALL text elements raster (customFont AND Cyrillic both apply)", async () => {
    const deps = makeDeterministicDeps();
    const zpl = await generateZpl(CONFIG_300, buildElements("customFont"), DATA_RU, deps);

    expect(zpl).toBe(
      HEADER_300 +
        "^FO59,59\n^GFA,4,4,4,2EB0AF9E\n^FS\n" +
        "^FO59,177\n^GFA,4,4,4,326BDF56\n^FS\n" +
        "^FO59,354\n^GFA,4,4,4,990A6BE3\n^FS\n" +
        "^FO650,59^BQN,2,8^FDQA,BADGE-RU-01^FS\n" +
        "^FO59,531^GB591,2,2^FS\n" +
        FOOTER,
    );
    expect(deps.rasterizeText).toHaveBeenCalledTimes(3);
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(1, "Анна", {
      fontFamily: "TestFamily",
      fontSizePx: 50,
      fontWeight: "normal",
    });
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(2, "Петрова", {
      fontFamily: "TestFamily",
      fontSizePx: 50,
      fontWeight: "normal",
    });
    // Same key as cell 3's company call ("Acme Inc"|TestFamily|42|normal) --
    // deliberately produces the SAME marker hex; the mock is a pure function
    // of its inputs, and the company text/font/size here are identical to
    // cell 3, so this is the expected (not accidental) reuse.
    expect(deps.rasterizeText).toHaveBeenNthCalledWith(3, "Acme Inc", {
      fontFamily: "TestFamily",
      fontSizePx: 42,
      fontWeight: "normal",
    });
  });
});

describe("golden ZPL matrix -- escaping fixture (^~\\ in a company name)", () => {
  it("escapes backslash, caret, then tilde in a company name on the native path (web/src/utils/zpl.ts:66-71)", async () => {
    const deps = makeDeterministicDeps();
    const data = { ...DATA_EN, company: "A^B~C\\D" };
    const zpl = await generateZpl(CONFIG_300, buildElements("native"), data, deps);

    expect(zpl).toBe(
      HEADER_300 +
        "^FO59,59^A0N,50,50^FDAnna^FS\n" +
        "^FO59,177^A0N,50,50^FDPetrova^FS\n" +
        // escapeZplData("A^B~C\\D"): backslash -> \\, then ^ -> \^, then ~ -> \~,
        // in that exact order (mirrors the escapeZplData unit test in
        // generateZpl.test.ts, applied here to a whole template's output).
        "^FO59,354^A0N,42,42^FDA\\^B\\~C\\\\D^FS\n" +
        "^FO650,59^BQN,2,8^FDQA,BADGE-EN-01^FS\n" +
        "^FO59,531^GB591,2,2^FS\n" +
        FOOTER,
    );
    expect(deps.rasterizeText).not.toHaveBeenCalled();
  });
});

describe("golden ZPL matrix -- valign (2026-07-20 live-run request: top/middle/bottom on the native path; also honored on raster since PR #88)", () => {
  // Native-path valign math (generateZpl.ts generateTextZPL): with height
  // set, y += round((heightDots - fontHeightDots)/2) for "middle" and
  // += (heightDots - fontHeightDots) for "bottom"; "top" adjusts nothing.
  // Hand-worked at 300dpi, fontSize 12 (fontHeightDots = 50), height 10mm
  // (heightDots = 118): middle offset = round(68/2) = 34, bottom = 68.
  it("adjusts the native ^FO y by the valign offset: top +0, middle +34, bottom +68 (10mm height, 12pt, 300dpi)", async () => {
    const deps = makeDeterministicDeps();
    const elements: RawBadgeElement[] = [
      { id: "v-top", type: "text", x: 5, y: 5, height: 10, fontSize: 12, fontFamily: "0", text: "Top", valign: "top" },
      { id: "v-mid", type: "text", x: 5, y: 20, height: 10, fontSize: 12, fontFamily: "0", text: "Middle", valign: "middle" },
      { id: "v-bot", type: "text", x: 5, y: 35, height: 10, fontSize: 12, fontFamily: "0", text: "Bottom", valign: "bottom" },
    ];
    const zpl = await generateZpl(CONFIG_300, elements, {}, deps);

    expect(zpl).toBe(
      HEADER_300 +
        // mmToDots(5) = 59: "top" is the no-adjustment default.
        "^FO59,59^A0N,50,50^FDTop^FS\n" +
        // mmToDots(20) = 236, +34 middle offset = 270.
        "^FO59,270^A0N,50,50^FDMiddle^FS\n" +
        // mmToDots(35) = 413, +68 bottom offset = 481.
        "^FO59,481^A0N,50,50^FDBottom^FS\n" +
        FOOTER,
    );
    expect(deps.rasterizeText).not.toHaveBeenCalled();
  });

  it("also honors valign on the raster path -- Cyrillic text with valign middle offsets ^FO by rasterFieldOrigin's slack (PR #88)", async () => {
    const deps = makeDeterministicDeps();
    const elements: RawBadgeElement[] = [
      { id: "v-ru", type: "text", x: 5, y: 5, height: 10, fontSize: 12, fontFamily: "0", text: "Анна", valign: "middle" },
    ];
    const zpl = await generateZpl(CONFIG_300, elements, {}, deps);

    // Same ("Анна"|Arial|50|normal) marker tuple as matrix cell 2/4's first
    // call -- deliberately identical hex. rasterFieldOrigin's valign slack
    // uses the RASTER bitmap's own measured height, not the font's: this
    // matrix's deterministic mock returns height:1 for every marker
    // (goldenMatrix's own header comment), so boxHeightDots
    // (mmToDots(10,300)=118) minus that 1 leaves slack=117, and "middle"
    // adds round(117/2)=59 to the plain y (mmToDots(5,300)=59), landing at
    // 118 -- unlike the native-path test above, this offset is NOT
    // comparable to font-height math since raster and native measure
    // against different reference heights (the bitmap's vs the font's).
    expect(zpl).toBe(HEADER_300 + "^FO59,118\n^GFA,4,4,4,AA5FCB93\n^FS\n" + FOOTER);
    expect(deps.rasterizeText).toHaveBeenCalledWith("Анна", {
      fontFamily: "Arial",
      fontSizePx: 50,
      fontWeight: "normal",
    });
  });
});

describe("golden ZPL matrix -- barcode caption toggle (2026-07-20 live-run request: ^BC interpretation line Y/N)", () => {
  // One bound barcode element; only `showCaption` varies across the three
  // cells. height 12mm at 300dpi -> mmToDots(12, 300) = 142.
  function barcodeElement(showCaption?: boolean): RawBadgeElement[] {
    const element: RawBadgeElement = { id: "b-code", type: "barcode", x: 5, y: 5, height: 12, source: "code" };
    if (showCaption !== undefined) element.showCaption = showCaption;
    return [element];
  }
  const DATA = { code: "BADGE-042" };

  it("cell 1/3 -- field absent (every pre-existing saved template): interpretation line stays Y", async () => {
    const zpl = await generateZpl(CONFIG_300, barcodeElement(), DATA, makeDeterministicDeps());
    expect(zpl).toBe(HEADER_300 + "^FO59,59^BCN,142,Y,N,N^FDBADGE-042^FS\n" + FOOTER);
  });

  it("cell 2/3 -- showCaption: true is byte-identical to the absent-field cell (back-compat default pinned)", async () => {
    const zplAbsent = await generateZpl(CONFIG_300, barcodeElement(), DATA, makeDeterministicDeps());
    const zplTrue = await generateZpl(CONFIG_300, barcodeElement(true), DATA, makeDeterministicDeps());
    expect(zplTrue).toBe(zplAbsent);
  });

  it("cell 3/3 -- showCaption: false flips exactly the interpretation-line argument to N, nothing else", async () => {
    const zpl = await generateZpl(CONFIG_300, barcodeElement(false), DATA, makeDeterministicDeps());
    expect(zpl).toBe(HEADER_300 + "^FO59,59^BCN,142,N,N,N^FDBADGE-042^FS\n" + FOOTER);
  });
});

describe("golden ZPL matrix -- dpi variant (203 vs 300 coordinate scaling)", () => {
  it("the SAME fixture (native font \"0\" x EN) scales every coordinate between 203dpi and 300dpi, nothing else", async () => {
    const deps300 = makeDeterministicDeps();
    const zpl300 = await generateZpl(CONFIG_300, buildElements("native"), DATA_EN, deps300);

    const deps203 = makeDeterministicDeps();
    const zpl203 = await generateZpl(CONFIG_203, buildElements("native"), DATA_EN, deps203);

    // 300dpi cell -- identical to matrix cell 1/4 above (repeated here so
    // the two dpi outputs sit side by side for a reviewer).
    expect(zpl300).toBe(
      HEADER_300 +
        "^FO59,59^A0N,50,50^FDAnna^FS\n" +
        "^FO59,177^A0N,50,50^FDPetrova^FS\n" +
        "^FO59,354^A0N,42,42^FDAcme Inc^FS\n" +
        "^FO650,59^BQN,2,8^FDQA,BADGE-EN-01^FS\n" +
        "^FO59,531^GB591,2,2^FS\n" +
        FOOTER,
    );

    // 203dpi -- every mm->dots and pt->dots value recomputed at the lower
    // dpi (mmToDots = round(mm/25.4*dpi), pointsToDots = round(pt/72*dpi));
    // the QR module size also drops (max(2, round(mmToDots(20,203)/30)) = 5
    // vs 8 at 300dpi). No native/raster routing changes with dpi alone.
    expect(zpl203).toBe(
      HEADER_203 +
        "^FO40,40^A0N,34,34^FDAnna^FS\n" +
        "^FO40,120^A0N,34,34^FDPetrova^FS\n" +
        "^FO40,240^A0N,28,28^FDAcme Inc^FS\n" +
        "^FO440,40^BQN,2,5^FDQA,BADGE-EN-01^FS\n" +
        "^FO40,360^GB400,2,2^FS\n" +
        FOOTER,
    );
    expect(deps300.rasterizeText).not.toHaveBeenCalled();
    expect(deps203.rasterizeText).not.toHaveBeenCalled();
  });

  it("the SAME fixture also scales correctly at 600dpi (document-settings' third DPI option)", async () => {
    const deps600 = makeDeterministicDeps();
    const zpl600 = await generateZpl(CONFIG_600, buildElements("native"), DATA_EN, deps600);

    // Every mm->dots/pt->dots value recomputed at 600dpi:
    //   x/y = round(5/25.4*600) = 118, round(15/25.4*600) = 354,
    //         round(30/25.4*600) = 709, round(45/25.4*600) = 1063
    //   fontHeight/Width = pointsToDots(12,600) = 100, pointsToDots(10,600) = 83
    //   QR module size = max(2, round(mmToDots(20,600)/30)) = max(2, round(472/30)) = 16
    //   line width = round(50/25.4*600) = 1181
    expect(zpl600).toBe(
      HEADER_600 +
        "^FO118,118^A0N,100,100^FDAnna^FS\n" +
        "^FO118,354^A0N,100,100^FDPetrova^FS\n" +
        "^FO118,709^A0N,83,83^FDAcme Inc^FS\n" +
        "^FO1299,118^BQN,2,16^FDQA,BADGE-EN-01^FS\n" +
        "^FO118,1063^GB1181,2,2^FS\n" +
        FOOTER,
    );
    expect(deps600.rasterizeText).not.toHaveBeenCalled();
  });
});
