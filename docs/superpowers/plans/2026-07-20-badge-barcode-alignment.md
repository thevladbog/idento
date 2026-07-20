# Badge Editor Barcode Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add left/center/right alignment to barcode elements in the panel badge editor, honored identically by both ZPL generators (panel TS + backend Go) and the panel's print-accuracy preview.

**Architecture:** Reuse the existing `align` field already present (but unread for barcode) on both stacks' `BadgeElement`. Right-align uses ZPL's native `^FOx,y,1` justification (the printer computes the true rendered Code 128 width itself — zero estimation error). Center-align has no native ZPL primitive, so it computes an `x` offset from a documented, approximate Code 128 module-width formula. Both are exposed as a small pure `barcodeFieldOrigin` helper in each stack, mirroring the `rasterFieldOrigin` pattern PR #88 already established, so the real ZPL output and the panel's canvas preview can never disagree.

**Tech Stack:** TypeScript/Vitest (panel), Go/`go test` (backend).

**Design doc:** [docs/superpowers/specs/2026-07-20-badge-barcode-alignment-design.md](../specs/2026-07-20-badge-barcode-alignment-design.md) — read this first for the full rationale (why `^FO`'s native justification was chosen over a computed offset for right-align, and why center's estimate is approximate).

## Global Constraints

- No schema/migration change: `align` already exists on both `BadgeElement` types (TS: `templateTypes.ts:27`, Go: `zpl.go:31`), currently read only by `generateTextZPL`/`generateBarcodeZPL`'s Go text counterpart.
- Left-align (field absent, or explicitly `"left"`) MUST remain byte-identical to today's output — no `^FO` third argument, `x` unchanged. This is a regression-safety requirement, not just a style preference.
- Zone width fallback is `element.width ?? 30` (mm) in every place it's computed — this already matches three existing call sites (`canvasMath.ts`'s `DEFAULT_SIZE_MM.barcode.width`, `ZplPreviewModal.tsx`'s barcode placeholder, and now the generators).
- Barcode module width for the center-align estimate is a fixed `2` dots (Zebra's `^BY` factory default, since neither generator ever emits `^BY`) — **not** dpi-scaled.
- Both generators (panel TS `generateZpl.ts` and backend Go `zpl.go`) must be updated together and produce parity results for the same input — this is the same requirement PR #87's `showCaption` field already established, because the real check-in/reprint print path only ever calls the Go generator.
- No new i18n keys: `badgePropsAlignment`/`badgeAlignLeft`/`badgeAlignCenter`/`badgeAlignRight` already exist in `panel/src/shared/i18n/en.json` and `ru.json` (added for text elements) and are reused verbatim.
- `BadgeCanvas.tsx`'s editor-canvas barcode placeholder is explicitly OUT OF SCOPE (see design doc) — do not touch it.
- Test commands: `npm test -w panel -- <path>` (Vitest, run from repo root), `go test ./internal/zpl/...` (run from `backend/`), `npm run typecheck -w panel`, `cd panel && npx eslint .`.

---

### Task 1: Panel TS generator — `estimateBarcodeWidthDots` + `barcodeFieldOrigin`, wired into `generateBarcodeZPL`

**Files:**
- Modify: `panel/src/features/badge/zpl/generateZpl.ts:324-348` (current `generateBarcodeZPL`)
- Test: `panel/src/features/badge/zpl/generateZpl.test.ts:17-27` (imports), `:229-273` (existing barcode describe block — add new describe blocks after it)

**Interfaces:**
- Produces: `estimateBarcodeWidthDots(dataLength: number): number` and `barcodeFieldOrigin(element: Pick<RawBadgeElement, "x" | "width" | "align">, dpi: number, dataLength: number): { x: number; rightJustified: boolean; estimatedWidthDots: number }`, both exported from `generateZpl.ts`. Task 3 (`ZplPreviewModal.tsx`) imports and calls `barcodeFieldOrigin` with the exact same signature.

- [ ] **Step 1: Write the failing tests**

Edit `panel/src/features/badge/zpl/generateZpl.test.ts`. First, update the import block at the top of the file:

```ts
import type { RasterResult } from "./zplImage";
import {
  barcodeFieldOrigin,
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
```

Then add the following new `describe` blocks immediately after the existing `describe("generateZpl -- barcode", ...)` block (which currently ends at line 273 with the closing `});`):

```ts
describe("estimateBarcodeWidthDots", () => {
  it("computes (dataLength + 2) * 11 + 13 modules at 2 dots/module (Zebra ^BY factory default)", () => {
    // "ABC123" is 6 chars: (6+2)*11+13 = 101 modules * 2 dots = 202.
    expect(estimateBarcodeWidthDots(6)).toBe(202);
  });

  it("still returns a positive width for an empty string (start/checksum/stop overhead only)", () => {
    // (0+2)*11+13 = 35 modules * 2 dots = 70.
    expect(estimateBarcodeWidthDots(0)).toBe(70);
  });
});

describe("barcodeFieldOrigin", () => {
  it("left/absent align: x is the zone's left edge, unchanged regardless of width", () => {
    expect(barcodeFieldOrigin({ x: 5, width: 30 }, 300, 6)).toEqual({
      x: 59, rightJustified: false, estimatedWidthDots: 202,
    });
    expect(barcodeFieldOrigin({ x: 5, align: "left" }, 300, 6)).toEqual({
      x: 59, rightJustified: false, estimatedWidthDots: 202,
    });
  });

  it("right align: x is the zone's right edge (left edge + zone width), rightJustified is true", () => {
    // zoneLeftDots=mmToDots(5,300)=59, zoneWidthDots=mmToDots(30,300)=354 -> x=413.
    expect(barcodeFieldOrigin({ x: 5, width: 30, align: "right" }, 300, 6)).toEqual({
      x: 413, rightJustified: true, estimatedWidthDots: 202,
    });
  });

  it("right align honors an explicit width (not just the 30mm default)", () => {
    // zoneWidthDots=mmToDots(50,300)=591 -> x=59+591=650.
    expect(barcodeFieldOrigin({ x: 5, width: 50, align: "right" }, 300, 6)).toEqual({
      x: 650, rightJustified: true, estimatedWidthDots: 202,
    });
  });

  it("falls back to the 30mm default zone width when width is omitted", () => {
    expect(barcodeFieldOrigin({ x: 5, align: "right" }, 300, 6)).toEqual({
      x: 413, rightJustified: true, estimatedWidthDots: 202,
    });
  });

  it("center align: x is offset by half the zone's slack over the estimated barcode width", () => {
    // slack = zoneWidthDots(354) - estimatedWidthDots(202) = 152; offset = round(152/2) = 76 -> x=59+76=135.
    expect(barcodeFieldOrigin({ x: 5, width: 30, align: "center" }, 300, 6)).toEqual({
      x: 135, rightJustified: false, estimatedWidthDots: 202,
    });
  });

  it("center align clamps to zero offset (never moves backward past the zone's left edge) when the estimate exceeds the zone width", () => {
    // zoneWidthDots=mmToDots(10,300)=118, estimatedWidthDots=202 -> negative slack clamps to 0.
    expect(barcodeFieldOrigin({ x: 5, width: 10, align: "center" }, 300, 6)).toEqual({
      x: 59, rightJustified: false, estimatedWidthDots: 202,
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w panel -- src/features/badge/zpl/generateZpl.test.ts`
Expected: FAIL — `barcodeFieldOrigin`/`estimateBarcodeWidthDots` are not exported from `./generateZpl` yet (import error), and the new `generateZpl -- barcode alignment` cases fail because `align` is not yet read by `generateBarcodeZPL`.

- [ ] **Step 3: Implement `estimateBarcodeWidthDots` + `barcodeFieldOrigin`, wire into `generateBarcodeZPL`**

In `panel/src/features/badge/zpl/generateZpl.ts`, replace the current `generateBarcodeZPL` function (lines 324-348):

```ts
/**
 * Generate ZPL for a barcode (Code 128) element. Ports
 * web/src/utils/zpl.ts:219-240 (`generateBarcodeZPL`).
 */
function generateBarcodeZPL(element: RawBadgeElement, data: Record<string, string>, dpi: number): string {
  const x = mmToDots(element.x, dpi);
  const y = mmToDots(element.y, dpi);

  const barcodeData = resolveElementText(element, data);

  const heightMM = element.height || 10;
  const height = mmToDots(heightMM, dpi);

  // ^BC's third argument prints the human-readable interpretation line.
  // web/src/utils/zpl.ts:237 hardcodes Y; this is the panel's one DELIBERATE
  // extension past web parity (2026-07-20 live-run request): only an
  // explicit `showCaption: false` flips it to N, so every template saved
  // before the field existed keeps its caption byte-for-byte. Also honored
  // by backend/internal/zpl/zpl.go's own `ShowCaption *bool` field + its own
  // generateBarcodeZPL, kept in sync deliberately -- the real check-in print
  // path only ever calls the Go generator, never this one.
  const interpretationLine = element.showCaption === false ? "N" : "Y";

  // ^BC = Code 128
  return `^FO${x},${y}^BCN,${height},${interpretationLine},N,N^FD${escapeZplData(barcodeData)}^FS`;
}
```

with:

```ts
// Zebra's own factory default module width (^BY's default, 2 dots) -- used
// here because neither this generator nor its backend/zpl.go twin ever
// emits ^BY, so the printer's built-in default module width is the width
// every barcode this pipeline generates actually prints at.
const BARCODE_MODULE_WIDTH_DOTS = 2;

/**
 * Estimated Code 128 rendered width in dots for `dataLength` input
 * characters -- APPROXIMATE (see design doc
 * docs/superpowers/specs/2026-07-20-badge-barcode-alignment-design.md):
 * assumes Code Set B (one symbol character per input character, 11 modules
 * each) plus a start character and a checksum character (also 11 modules
 * each) and the wider 13-module stop character. All-numeric data may print
 * NARROWER than this estimate if the printer's firmware auto-switches to
 * Code Set C (two digits packed per symbol character) -- this is a
 * documented upper-bound estimate, not an exact value.
 */
export function estimateBarcodeWidthDots(dataLength: number): number {
  const moduleCount = (dataLength + 2) * 11 + 13;
  return moduleCount * BARCODE_MODULE_WIDTH_DOTS;
}

/**
 * Compute the ^FO origin (and whether to append ^FO's right-justification
 * argument) for a barcode element -- the barcode-branch counterpart to
 * rasterFieldOrigin above, for the SAME reason: exported so
 * ZplPreviewModal.tsx's Rendered-tab barcode placeholder can apply the exact
 * same offset generateBarcodeZPL's real ^FO uses, so the preview can never
 * disagree with what actually prints.
 *
 *  - "right": uses ^FO's own native z=1 justification argument -- `x`
 *    becomes the zone's RIGHT edge, and the printer computes the barcode's
 *    true rendered width itself at print time (zero estimation error,
 *    since Code 128's exact width depends on data-driven subset switching
 *    this pipeline can't fully predict).
 *  - "center": ^FO has no center-justification option, so `x` is computed
 *    from estimateBarcodeWidthDots's approximation, with left justification
 *    (no ^FO third argument) at that computed x. Slack is clamped to 0 so
 *    an estimated-wider-than-zone barcode never moves backward past the
 *    zone's own left edge.
 *  - "left"/absent: UNCHANGED -- `x` is the zone's left edge, no ^FO third
 *    argument, byte-identical to every template saved before this feature
 *    existed.
 *
 * Zone width is `element.width ?? 30` (mm), matching canvasMath.ts's
 * DEFAULT_SIZE_MM.barcode.width and ZplPreviewModal.tsx's own existing
 * barcode-placeholder fallback -- generateBarcodeZPL didn't read `width` at
 * all before this feature, so this is a new but precedent-matching default.
 */
export function barcodeFieldOrigin(
  element: Pick<RawBadgeElement, "x" | "width" | "align">,
  dpi: number,
  dataLength: number,
): { x: number; rightJustified: boolean; estimatedWidthDots: number } {
  const zoneLeftDots = mmToDots(element.x, dpi);
  const zoneWidthDots = mmToDots(element.width ?? 30, dpi);
  const estimatedWidthDots = estimateBarcodeWidthDots(dataLength);

  if (element.align === "right") {
    return { x: zoneLeftDots + zoneWidthDots, rightJustified: true, estimatedWidthDots };
  }
  if (element.align === "center") {
    const offset = Math.max(0, Math.round((zoneWidthDots - estimatedWidthDots) / 2));
    return { x: zoneLeftDots + offset, rightJustified: false, estimatedWidthDots };
  }
  return { x: zoneLeftDots, rightJustified: false, estimatedWidthDots };
}

/**
 * Generate ZPL for a barcode (Code 128) element. Ports
 * web/src/utils/zpl.ts:219-240 (`generateBarcodeZPL`).
 */
function generateBarcodeZPL(element: RawBadgeElement, data: Record<string, string>, dpi: number): string {
  const y = mmToDots(element.y, dpi);

  const barcodeData = resolveElementText(element, data);

  const heightMM = element.height || 10;
  const height = mmToDots(heightMM, dpi);

  // ^BC's third argument prints the human-readable interpretation line.
  // web/src/utils/zpl.ts:237 hardcodes Y; this is the panel's one DELIBERATE
  // extension past web parity (2026-07-20 live-run request): only an
  // explicit `showCaption: false` flips it to N, so every template saved
  // before the field existed keeps its caption byte-for-byte. Also honored
  // by backend/internal/zpl/zpl.go's own `ShowCaption *bool` field + its own
  // generateBarcodeZPL, kept in sync deliberately -- the real check-in print
  // path only ever calls the Go generator, never this one.
  const interpretationLine = element.showCaption === false ? "N" : "Y";

  const origin = barcodeFieldOrigin(element, dpi, barcodeData.length);
  const foSuffix = origin.rightJustified ? ",1" : "";

  // ^BC = Code 128
  return `^FO${origin.x},${y}${foSuffix}^BCN,${height},${interpretationLine},N,N^FD${escapeZplData(barcodeData)}^FS`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w panel -- src/features/badge/zpl/generateZpl.test.ts`
Expected: PASS — all cases in `estimateBarcodeWidthDots`, `barcodeFieldOrigin`, `generateZpl -- barcode alignment`, plus every pre-existing case in `generateZpl -- barcode` (regression check on the byte-identical left/absent path).

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/badge/zpl/generateZpl.ts panel/src/features/badge/zpl/generateZpl.test.ts
git commit -m "$(cat <<'EOF'
panel: barcode element alignment (left/center/right) in generateZpl.ts

Right-align uses ^FO's native z=1 justification (printer computes the
true rendered width, zero estimation error); center computes an offset
from a documented Code 128 module-width estimate; left is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Golden ZPL matrix — aligned barcode fixture

**Files:**
- Modify: `panel/src/features/badge/zpl/goldenMatrix.test.ts` (add a new describe block after the existing `"golden ZPL matrix -- barcode caption toggle..."` block, which currently ends at line 340)

**Interfaces:**
- Consumes: `generateZpl` (already imported in this file), no new imports needed — this task calls only the full-pipeline function, not `barcodeFieldOrigin`/`estimateBarcodeWidthDots` directly.

- [ ] **Step 1: Write the failing test**

In `panel/src/features/badge/zpl/goldenMatrix.test.ts`, insert this new `describe` block immediately after the existing `describe("golden ZPL matrix -- barcode caption toggle...", ...)` block's closing `});` (currently at line 340) and before `describe("golden ZPL matrix -- dpi variant...", ...)`:

```ts
describe("golden ZPL matrix -- barcode alignment (left/center/right)", () => {
  // Same bound barcode element as the caption-toggle matrix above, plus
  // `align` varying across cells. height 12mm at 300dpi -> 142 dots (as
  // above); default 30mm width zone -> mmToDots(30,300) = 354 dots.
  // "BADGE-042" is 9 chars: estimatedWidthDots = ((9+2)*11+13)*2 = 268.
  function alignedBarcodeElement(align?: "left" | "center" | "right"): RawBadgeElement[] {
    const element: RawBadgeElement = { id: "b-code", type: "barcode", x: 5, y: 5, height: 12, source: "code" };
    if (align !== undefined) element.align = align;
    return [element];
  }
  const DATA = { code: "BADGE-042" };

  it("cell 1/3 -- align absent: unchanged from the caption-toggle matrix's own cell 1 (no ^FO third argument)", async () => {
    const zpl = await generateZpl(CONFIG_300, alignedBarcodeElement(), DATA, makeDeterministicDeps());
    expect(zpl).toBe(HEADER_300 + "^FO59,59^BCN,142,Y,N,N^FDBADGE-042^FS\n" + FOOTER);
  });

  it("cell 2/3 -- align: \"right\" appends ^FO's z=1 argument, x at the zone's right edge", async () => {
    const zpl = await generateZpl(CONFIG_300, alignedBarcodeElement("right"), DATA, makeDeterministicDeps());
    // x = zoneLeftDots(59) + zoneWidthDots(354) = 413.
    expect(zpl).toBe(HEADER_300 + "^FO413,59,1^BCN,142,Y,N,N^FDBADGE-042^FS\n" + FOOTER);
  });

  it("cell 3/3 -- align: \"center\" computes an offset x, no ^FO third argument", async () => {
    const zpl = await generateZpl(CONFIG_300, alignedBarcodeElement("center"), DATA, makeDeterministicDeps());
    // estimatedWidthDots = ((9+2)*11+13)*2 = 268; slack = 354-268 = 86; offset = round(86/2) = 43; x = 59+43 = 102.
    expect(zpl).toBe(HEADER_300 + "^FO102,59^BCN,142,Y,N,N^FDBADGE-042^FS\n" + FOOTER);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w panel -- src/features/badge/zpl/goldenMatrix.test.ts`
Expected: FAIL on cells 2/3 and 3/3 (align isn't wired into `generateBarcodeZPL` output yet) — wait, Task 1 already implemented that. Since Task 1 lands first, this step should actually PASS already if Task 1's implementation is correct. Run it anyway as the required verification step; if it passes immediately, note in the commit that this task only added regression-fixture coverage on top of Task 1's implementation (no new code, test-only commit).

- [ ] **Step 3: Confirm passing (no implementation change needed — reuses Task 1's code)**

If Step 2 already passed, skip to Step 4. If it failed, re-check that Task 1's commit landed on this branch before proceeding (do not re-implement generateBarcodeZPL here).

- [ ] **Step 4: Run the full matrix file to verify no regressions**

Run: `npm test -w panel -- src/features/badge/zpl/goldenMatrix.test.ts`
Expected: PASS — all cells, including the pre-existing caption-toggle and font/dpi matrix cells.

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/badge/zpl/goldenMatrix.test.ts
git commit -m "$(cat <<'EOF'
panel: golden-matrix fixture for barcode alignment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ZplPreviewModal.tsx` canvas preview parity

**Files:**
- Modify: `panel/src/features/badge/ZplPreviewModal.tsx:28-32` (import), `:447-470` (barcode case of `drawElement`)

**Interfaces:**
- Consumes: `barcodeFieldOrigin` from Task 1 (`{ x: number; rightJustified: boolean; estimatedWidthDots: number }`).
- No new automated test: this file's canvas drawing is documented as untestable under jsdom (no 2D context — see the file's own header comment and `RenderedPreview`'s doc comment), the same limitation PR #88's raster align/valign fix already worked within. Verification is: (a) the existing `ZplPreviewModal.test.tsx` suite still passes (no barcode-drawing regressions in what IS testable — tab switching, ZPL text tab, warnings), and (b) manual confirmation on the next physical Zebra printed-matrix run per the design doc.

- [ ] **Step 1: Update the import**

In `panel/src/features/badge/ZplPreviewModal.tsx`, replace:

```ts
import {
  generateZpl, mapZPLFontToSystemFont, mmToDots, needsImageRendering, pointsToDots,
  rasterFieldOrigin, valignOffsetDots,
  type RawBadgeElement,
} from "./zpl/generateZpl";
```

with:

```ts
import {
  barcodeFieldOrigin, generateZpl, mapZPLFontToSystemFont, mmToDots, needsImageRendering, pointsToDots,
  rasterFieldOrigin, valignOffsetDots,
  type RawBadgeElement,
} from "./zpl/generateZpl";
```

- [ ] **Step 2: Run the existing preview test suite to confirm the current baseline passes before touching drawElement**

Run: `npm test -w panel -- src/features/badge/ZplPreviewModal.test.tsx`
Expected: PASS (import-only change so far, no behavior change yet).

- [ ] **Step 3: Update the barcode case of `drawElement`**

Replace the current `case "barcode":` block (lines 447-470):

```ts
    case "barcode": {
      const value = resolveElementText(element, previewData);
      const heightDots = mmToDots(element.height || 10, config.dpi);
      const widthDots = mmToDots(element.width || 30, config.dpi);
      // Striped placeholder -- no barcode-rendering lib in this repo
      // (YAGNI, per plan), same honest "approximation, not scannable"
      // treatment BadgeCanvas.tsx's own barcode placeholder uses.
      // PRINT_INK -- see this file's exception comment above.
      ctx.fillStyle = PRINT_INK;
      const stripeWidth = Math.max(2, Math.round(widthDots / 40));
      for (let sx = 0; sx < widthDots; sx += stripeWidth * 2) {
        ctx.fillRect(x + sx, y, stripeWidth, heightDots);
      }
      // Mirrors generateZpl.ts's generateBarcodeZPL: showCaption === false is
      // the only value that suppresses the interpretation line -- absent/true
      // both print it (back-compat default). Drawn value text below the bars
      // stands in for ^BC's own caption line, so it follows the same gate.
      if (element.showCaption !== false) {
        ctx.font = `${Math.round(config.dpi / 25)}px monospace`;
        ctx.textBaseline = "top";
        ctx.fillText(value, x, y + heightDots + 4);
      }
      return;
    }
```

with:

```ts
    case "barcode": {
      const value = resolveElementText(element, previewData);
      const heightDots = mmToDots(element.height || 10, config.dpi);
      const zoneWidthDots = mmToDots(element.width || 30, config.dpi);
      const origin = barcodeFieldOrigin(element, config.dpi, value.length);
      // Placeholder span: the full zone width for left/absent align
      // (matches this approximation's existing behavior), or the SAME
      // estimated width barcodeFieldOrigin used to compute a center offset
      // / that a real right-aligned barcode would occupy -- otherwise a
      // centered or right-aligned barcode would still visually fill the
      // WHOLE zone, defeating the point of showing alignment at all here.
      const placeholderWidthDots = element.align === "center" || element.align === "right"
        ? origin.estimatedWidthDots
        : zoneWidthDots;
      // For right align, origin.x is the zone's RIGHT edge (what the real
      // ^FO needs); the placeholder draws left-to-right, so its start is
      // that edge minus the span above. Left/center already start exactly
      // where the placeholder should.
      const placeholderStartX = element.align === "right"
        ? origin.x - placeholderWidthDots
        : origin.x;
      // Striped placeholder -- no barcode-rendering lib in this repo
      // (YAGNI, per plan), same honest "approximation, not scannable"
      // treatment BadgeCanvas.tsx's own barcode placeholder uses. Shifted by
      // barcodeFieldOrigin's SAME offset generateZpl's real ^FO uses, so
      // this preview can never disagree with what actually prints (same
      // "true preview" principle PR #88 established for raster align/valign).
      // PRINT_INK -- see this file's exception comment above.
      ctx.fillStyle = PRINT_INK;
      const stripeWidth = Math.max(2, Math.round(placeholderWidthDots / 40));
      for (let sx = 0; sx < placeholderWidthDots; sx += stripeWidth * 2) {
        ctx.fillRect(placeholderStartX + sx, y, stripeWidth, heightDots);
      }
      // Mirrors generateZpl.ts's generateBarcodeZPL: showCaption === false is
      // the only value that suppresses the interpretation line -- absent/true
      // both print it (back-compat default). Drawn value text below the bars
      // stands in for ^BC's own caption line, so it follows the same gate.
      if (element.showCaption !== false) {
        ctx.font = `${Math.round(config.dpi / 25)}px monospace`;
        ctx.textBaseline = "top";
        ctx.fillText(value, placeholderStartX, y + heightDots + 4);
      }
      return;
    }
```

- [ ] **Step 4: Run the full panel test suite + typecheck to confirm no regressions**

Run: `npm test -w panel -- src/features/badge/ZplPreviewModal.test.tsx`
Expected: PASS (same tests as Step 2 — this file has no barcode-specific drawing test to add, per the jsdom limitation noted above).

Run: `npm run typecheck -w panel`
Expected: clean (no type errors).

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/badge/ZplPreviewModal.tsx
git commit -m "$(cat <<'EOF'
panel: ZplPreviewModal barcode placeholder honors alignment

Shifts the canvas preview's barcode placeholder using the same
barcodeFieldOrigin offset generateZpl's real ^FO uses, so the preview
can never disagree with what actually prints (same principle as PR
#88's raster align/valign fix).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Backend Go generator — mirror `estimateBarcodeWidthDots` + `barcodeFieldOrigin`

**Files:**
- Modify: `backend/internal/zpl/zpl.go:1-11` (imports), `:246-274` (current `generateBarcodeZPL`)
- Test: `backend/internal/zpl/zpl_test.go` (append a new `TestGenerateBarcodeAlignment` function)

**Interfaces:**
- Produces: `estimateBarcodeWidthDots(dataLength int) int` and `barcodeFieldOrigin(el BadgeElement, dpi int, dataLength int) (x int, rightJustified bool)` in package `zpl` — same formula/constants as Task 1's TS twins, so both stacks produce identical `x` values for the same input (verified by using the SAME numeric fixtures in this task's tests as Task 1's).

- [ ] **Step 1: Write the failing test**

Append this to the end of `backend/internal/zpl/zpl_test.go`:

```go
// TestGenerateBarcodeAlignment pins the backend half of barcode alignment
// (panel/src/features/badge/zpl/generateZpl.ts's barcodeFieldOrigin has the
// TypeScript twin of every case here, using the SAME numeric fixtures for
// cross-stack parity) -- the real check-in print path only ever calls this
// Go generator, never the panel's own TypeScript port, so alignment must
// work here too, not just in the panel's preview.
func TestGenerateBarcodeAlignment(t *testing.T) {
	cfg := Config{WidthMM: 90, HeightMM: 55, DPI: 300}

	t.Run("left/absent align is byte-identical to today's output (no ^FO third argument)", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "ABC123"}}
		zpl := Generate(cfg, els, nil)
		if want := "^FO59,59^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("right align appends ^FO's z=1 justification argument, x at the zone's right edge (default 30mm width)", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "ABC123", Align: "right"}}
		zpl := Generate(cfg, els, nil)
		// x = zoneLeftDots(59) + zoneWidthDots(354) = 413.
		if want := "^FO413,59,1^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("right align honors an explicit width zone, not just the 30mm default", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Width: 50, Text: "ABC123", Align: "right"}}
		zpl := Generate(cfg, els, nil)
		// x = zoneLeftDots(59) + zoneWidthDots(591) = 650.
		if want := "^FO650,59,1^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("center align computes an x offset with no ^FO third argument", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "ABC123", Align: "center"}}
		zpl := Generate(cfg, els, nil)
		// estimatedWidthDots = ((6+2)*11+13)*2 = 202; slack = 354-202 = 152; offset = round(152/2) = 76; x = 59+76 = 135.
		if want := "^FO135,59^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("center align clamps to zero offset when the estimate exceeds a narrow explicit width zone", func(t *testing.T) {
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Width: 10, Text: "ABC123", Align: "center"}}
		zpl := Generate(cfg, els, nil)
		// zoneWidthDots=mmToDots(10,300)=118, estimatedWidthDots=202 -> negative slack clamps to 0 -> x=59.
		if want := "^FO59,59^BCN,118,Y,N,N^FH^FDABC123^FS"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q in output, got: %q", want, zpl)
		}
	})

	t.Run("uses rune count, not byte count, for Cyrillic barcode data", func(t *testing.T) {
		// "Привет" is 6 Cyrillic runes but 12 UTF-8 bytes -- byte-counting
		// would inflate the estimated width and shift the computed x.
		els := []BadgeElement{{ID: "e1", Type: "barcode", X: 5, Y: 5, Text: "Привет", Align: "center"}}
		zpl := Generate(cfg, els, nil)
		// estimatedWidthDots = ((6+2)*11+13)*2 = 202 (same as "ABC123", 6 runes); offset = 76; x = 135.
		if want := "^FO135,59"; !strings.Contains(zpl, want) {
			t.Fatalf("expected %q (rune-counted x) in output, got: %q", want, zpl)
		}
	})
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `go test ./internal/zpl/... -run TestGenerateBarcodeAlignment -v`
Expected: FAIL — `Align` isn't read by `generateBarcodeZPL` yet, so `x` stays at the unaligned value for every case except the first.

- [ ] **Step 3: Implement `estimateBarcodeWidthDots` + `barcodeFieldOrigin`, wire into `generateBarcodeZPL`**

In `backend/internal/zpl/zpl.go`, update the import block (lines 5-11):

```go
import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)
```

Then replace the current `generateBarcodeZPL` function (lines 246-274):

```go
func generateBarcodeZPL(el BadgeElement, data map[string]interface{}, dpi int) string {
	x := mmToDots(el.X, dpi)
	y := mmToDots(el.Y, dpi)

	barcodeData := el.Text
	if el.Source != "" {
		if v := getDataString(data, el.Source); v != "" {
			barcodeData = v
		}
	}
	barcodeData = escapeZPL(barcodeData)

	heightMM := el.Height
	if heightMM <= 0 {
		heightMM = 10
	}
	height := mmToDots(heightMM, dpi)

	// ^BC's third argument prints the human-readable interpretation line.
	// Only an explicit `showCaption: false` flips it to N -- nil (absent,
	// every template saved before this field existed) and a pointer to true
	// both keep it Y, matching the panel's own generateZpl.ts port exactly.
	interpretationLine := "Y"
	if el.ShowCaption != nil && !*el.ShowCaption {
		interpretationLine = "N"
	}

	return fmt.Sprintf("^FO%d,%d^BCN,%d,%s,N,N^FH^FD%s^FS", x, y, height, interpretationLine, barcodeData)
}
```

with:

```go
// barcodeModuleWidthDots is Zebra's own factory default module width (^BY's
// default, 2 dots) -- used here because neither this generator nor its
// panel/generateZpl.ts twin ever emits ^BY, so the printer's built-in
// default module width is the width every barcode this pipeline generates
// actually prints at.
const barcodeModuleWidthDots = 2

// estimateBarcodeWidthDots returns an APPROXIMATE Code 128 rendered width in
// dots for dataLength input characters (see design doc
// docs/superpowers/specs/2026-07-20-badge-barcode-alignment-design.md):
// assumes Code Set B (one symbol character per input character, 11 modules
// each) plus a start character and a checksum character (also 11 modules
// each) and the wider 13-module stop character. All-numeric data may print
// NARROWER than this estimate if the printer's firmware auto-switches to
// Code Set C (two digits packed per symbol character) -- a documented
// upper-bound estimate, not an exact value. Mirrors panel/generateZpl.ts's
// estimateBarcodeWidthDots exactly.
func estimateBarcodeWidthDots(dataLength int) int {
	moduleCount := (dataLength+2)*11 + 13
	return moduleCount * barcodeModuleWidthDots
}

// barcodeFieldOrigin computes the ^FO x coordinate (and whether to append
// ^FO's right-justification argument) for a barcode element. Mirrors
// panel/src/features/badge/zpl/generateZpl.ts's barcodeFieldOrigin exactly
// -- see that function's own comment for the full left/center/right
// rationale (^FO's native z=1 justification for right, zero estimation
// error; a computed estimate-based offset for center, since ^FO has no
// center-justification option; left/absent unchanged).
func barcodeFieldOrigin(el BadgeElement, dpi int, dataLength int) (x int, rightJustified bool) {
	zoneLeft := mmToDots(el.X, dpi)
	widthMM := el.Width
	if widthMM <= 0 {
		widthMM = 30
	}
	zoneWidth := mmToDots(widthMM, dpi)

	switch el.Align {
	case "right":
		return zoneLeft + zoneWidth, true
	case "center":
		estimated := estimateBarcodeWidthDots(dataLength)
		offset := int(math.Round(float64(zoneWidth-estimated) / 2))
		if offset < 0 {
			offset = 0
		}
		return zoneLeft + offset, false
	default:
		return zoneLeft, false
	}
}

func generateBarcodeZPL(el BadgeElement, data map[string]interface{}, dpi int) string {
	y := mmToDots(el.Y, dpi)

	barcodeData := el.Text
	if el.Source != "" {
		if v := getDataString(data, el.Source); v != "" {
			barcodeData = v
		}
	}

	x, rightJustified := barcodeFieldOrigin(el, dpi, utf8.RuneCountInString(barcodeData))
	barcodeData = escapeZPL(barcodeData)

	heightMM := el.Height
	if heightMM <= 0 {
		heightMM = 10
	}
	height := mmToDots(heightMM, dpi)

	// ^BC's third argument prints the human-readable interpretation line.
	// Only an explicit `showCaption: false` flips it to N -- nil (absent,
	// every template saved before this field existed) and a pointer to true
	// both keep it Y, matching the panel's own generateZpl.ts port exactly.
	interpretationLine := "Y"
	if el.ShowCaption != nil && !*el.ShowCaption {
		interpretationLine = "N"
	}

	foSuffix := ""
	if rightJustified {
		foSuffix = ",1"
	}

	return fmt.Sprintf("^FO%d,%d%s^BCN,%d,%s,N,N^FH^FD%s^FS", x, y, foSuffix, height, interpretationLine, barcodeData)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `go test ./internal/zpl/... -run TestGenerateBarcodeAlignment -v`
Expected: PASS — all 6 subtests.

Run (from `backend/`): `go test ./internal/zpl/...`
Expected: PASS — the full package, including `TestGenerateBarcodeHonorsShowCaptionField` and `TestParseBadgeTemplateStructRawPathAlsoHonorsShowCaption` (regression check: left/absent align must stay byte-identical, so those pre-existing showCaption fixtures — which never set `Align` — must be unaffected).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/zpl/zpl.go backend/internal/zpl/zpl_test.go
git commit -m "$(cat <<'EOF'
backend: barcode element alignment (left/center/right) in zpl.go

Mirrors panel/generateZpl.ts's barcodeFieldOrigin exactly -- the real
check-in/reprint print path only ever calls this Go generator, so
alignment must be honored here, not just in the panel's own preview.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Panel UI — `PropertiesPane.tsx` alignment control for barcode elements

**Files:**
- Modify: `panel/src/features/badge/PropertiesPane.tsx:372-374` (insert `renderAlignmentControl` before `return`), `:421-423` (insert barcode section), `:485-512` (replace inline text alignment JSX with the shared call)
- Test: `panel/src/features/badge/PropertiesPane.test.tsx` (insert a new `describe("alignment buttons", ...)` inside `describe("barcode element", ...)`)

**Interfaces:**
- Consumes: `element.align` (`BadgeElement.align`, already typed), `ALIGN_OPTIONS` (already defined in this file), `patch` (existing local closure), `t` (existing `useTranslation` result) — no new props on `PropertiesPaneProps`.

- [ ] **Step 1: Write the failing tests**

In `panel/src/features/badge/PropertiesPane.test.tsx`, insert this new `describe` block inside the existing `describe("barcode element", ...)`, immediately after the first `it("shows the common section + binding select + caption toggle", ...)` block's closing `});` and before the `// 2026-07-20 live-run request: generateBarcodeZPL's ^BC interpretation` comment that precedes the `"caption toggle"` describe:

```ts
    // 2026-07-20 barcode-alignment request: the SAME alignment control text
    // elements already have (ALIGN_OPTIONS, renderAlignmentControl in
    // PropertiesPane.tsx) now also renders for barcode elements -- reusing
    // generateZpl.ts's `align` field and this pane's existing i18n keys, no
    // new ones.
    describe("alignment buttons", () => {
      it("shows the alignment buttons for a barcode element", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
          },
        });

        expect(screen.getByRole("button", { name: "Align left" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Align center" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Align right" })).toBeInTheDocument();
      });

      it("clicking a segment patches align and only that segment is aria-pressed", () => {
        const { onUpdate } = renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
          },
        });

        fireEvent.click(screen.getByRole("button", { name: "Align center" }));

        expect(onUpdate).toHaveBeenCalledWith("e1", { align: "center" });
      });

      it("defaults to Align left pressed when the element has no explicit align", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code",
          },
        });

        expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "true");
      });

      it("shows the element's current align as pressed", () => {
        renderPane({
          element: {
            id: "e1", type: "barcode", x: 5, y: 5, width: 30, height: 10, source: "code", align: "right",
          },
        });

        expect(screen.getByRole("button", { name: "Align right" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Align left" })).toHaveAttribute("aria-pressed", "false");
      });
    });

```

(Leave the pre-existing `"caption toggle"` describe block, and its own preceding comment, exactly where it is — this new block is inserted just before it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w panel -- src/features/badge/PropertiesPane.test.tsx`
Expected: FAIL — the new "alignment buttons" tests fail (`getByRole("button", { name: "Align left" })` finds nothing for a barcode element); all pre-existing tests in this file still pass.

- [ ] **Step 3: Implement — extract a shared `renderAlignmentControl` and render it for barcode too**

In `panel/src/features/badge/PropertiesPane.tsx`, first insert the shared render function. Replace:

```tsx
  const footprint = elementFootprint(element);

  return (
```

with:

```tsx
  const footprint = elementFootprint(element);

  // Shared between text (its original position, unchanged) and barcode
  // (2026-07-20 barcode-alignment request) -- one JSX definition so the two
  // call sites can never drift apart, mirroring the codebase's existing
  // "one canonical computation" convention (e.g. rasterFieldOrigin,
  // valignOffsetDots in generateZpl.ts).
  function renderAlignmentControl() {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-card-title text-foreground">{t("badgePropsAlignment")}</span>
        <div
          role="group"
          aria-label={t("badgePropsAlignment")}
          className="inline-flex w-fit gap-1 rounded-md border border-border p-0.5"
        >
          {ALIGN_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
            const pressed = (element!.align ?? "left") === value;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={pressed}
                aria-label={t(labelKey)}
                className={cn(pressed && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
                onClick={() => patch({ align: value })}
              >
                <Icon aria-hidden className="size-4" />
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
```

Next, insert the barcode call site. Replace:

```tsx
      )}

      {isTextType && (
```

with:

```tsx
      )}

      {isBarcodeType && renderAlignmentControl()}

      {isTextType && (
```

Finally, replace the inline text-alignment JSX with a call to the shared function (this removes the duplicated block and keeps text's rendered order exactly unchanged — Alignment still appears between Font size and Vertical align). Replace:

```tsx
          <div className="flex flex-col gap-1">
            <span className="text-card-title text-foreground">{t("badgePropsAlignment")}</span>
            <div
              role="group"
              aria-label={t("badgePropsAlignment")}
              className="inline-flex w-fit gap-1 rounded-md border border-border p-0.5"
            >
              {ALIGN_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
                const pressed = (element.align ?? "left") === value;
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={pressed}
                    aria-label={t(labelKey)}
                    className={cn(pressed && "border-foreground bg-foreground text-background hover:bg-foreground/90")}
                    onClick={() => patch({ align: value })}
                  >
                    <Icon aria-hidden className="size-4" />
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-card-title text-foreground">{t("badgePropsValign")}</span>
```

with:

```tsx
          {renderAlignmentControl()}

          <div className="flex flex-col gap-1">
            <span className="text-card-title text-foreground">{t("badgePropsValign")}</span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w panel -- src/features/badge/PropertiesPane.test.tsx`
Expected: PASS — all new "alignment buttons" cases under "barcode element", plus every pre-existing test in this file (text element's alignment/valign/rotation tests, qrcode's "no alignment buttons" assertion at the existing `queryByRole("button", { name: /Align/ })` check, line/box's binding-absence checks).

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck -w panel`
Expected: clean.

Run: `cd panel && npx eslint src/features/badge/PropertiesPane.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add panel/src/features/badge/PropertiesPane.tsx panel/src/features/badge/PropertiesPane.test.tsx
git commit -m "$(cat <<'EOF'
panel: barcode elements get the alignment control in PropertiesPane

Extracts the existing text-only alignment button group into a shared
renderAlignmentControl, called from both text (unchanged position) and
barcode elements. Reuses the existing align field and i18n keys.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan verification (run once all 5 tasks are committed)

- [ ] `npm test -w panel` (full panel suite) — expect all green.
- [ ] `npm run typecheck -w panel` — expect clean.
- [ ] `cd panel && npx eslint .` — expect clean.
- [ ] `npm run build -w panel` — expect success.
- [ ] `cd backend && go test ./...` — expect all green.
- [ ] Note in the PR description that center-align's accuracy is an approximation (documented in the design doc) and should be confirmed on the physical Zebra ZD421 in the next printed-matrix run, per this project's established hardware-verification gate.
