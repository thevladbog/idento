# Fit-to-width Code 128 barcode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make badge barcode width deterministic and zone-aware — compute the Code 128 module width from the zone width and data length, emit it as an explicit `^BY`, and use that same width for centering — fixing the 2026-07-20 Zebra center-shift bug and bounding long-code overflow.

**Architecture:** Two ZPL generators change in lockstep (panel TS `generateZpl.ts` drives preview + test-print; backend Go `zpl.go` is the ONLY generator the real check-in/reprint path calls). A single computation — `moduleWidth = clamp(floor(zoneWidthDots / footprintModules), 2, 3)` — feeds both the emitted `^BY` and the centering estimate, so preview and print can never disagree. The panel `PropertiesPane` gains an advisory (non-blocking) warning when a code can't fit readably, guiding long values to the QR element.

**Tech Stack:** TypeScript (Vitest, MSW, React 19), Go (`backend/internal/zpl`, standard `testing`), openapi-typescript generated client (untouched here — no schema change).

**Spec:** `docs/superpowers/specs/2026-07-20-badge-barcode-fit-to-width-design.md` (user-approved). Supersedes the `moduleWidthDots = 2` assumption in `2026-07-20-badge-barcode-alignment-design.md` (PR #90).

## Global Constraints

- Branch `worktree-badge-barcode-fit-to-width` (worktree `.claude/worktrees/badge-barcode-fit-to-width`), base = main `0fedd3d`. Run everything from the worktree root; `git branch --show-current` before every commit (subagent-cwd hazard — see memory).
- **Both generators must stay byte-for-byte equivalent** — the same dual-generator discipline `showCaption` (PR #87) and `barcodeFieldOrigin` (PR #90) follow. A change to one WITHOUT the other is a defect.
- Constants (single source of truth, identical in both files): `QUIET_MODULES = 10`, `MIN_MODULE_DOTS = 2`, `MAX_MODULE_DOTS = 3`.
- `footprintModules(len) = (len + 2) * 11 + 13 + 2 * QUIET_MODULES` (bars + quiet zones — the fit calc).
- `footprintBarModules(len) = (len + 2) * 11 + 13` (bars only — the centering estimate; quiet zones are layout margin, not part of the `^FO`-anchored symbol width).
- `moduleWidth(len, zoneW) = clamp(floor(zoneW / footprintModules(len)), MIN_MODULE_DOTS, MAX_MODULE_DOTS)`.
- `overflows(len, zoneW) = footprintModules(len) * MIN_MODULE_DOTS > zoneW`.
- Emitted ZPL shape: `^BY{mw}^FO{x},{y}{,1 if right}^BCN,{h},{Y|N},N,N^FD{data}^FS` — `^BY` immediately precedes the barcode (persistent modal command; one barcode per label so no leakage).
- Readability floor `^BY2` (never `^BY1`); ceiling `^BY3`. Warning is advisory — never blocks save/print.
- No symbology switcher, no schema/migration, `BadgeCanvas.tsx` unchanged (PR #90 precedent).
- i18n: flat keys, EN + real RU, `keyParity.test.ts` green. Panel typecheck via `npm run typecheck -w panel` (NEVER bare tsc). Lint via direct `npx eslint .` in panel/ if the rtk wrapper mis-parses clean output.
- TDD per task; commit at every green step. Gates before "done": `npm run test -w panel && npm run typecheck -w panel && npx eslint .` (panel), `npm run test -w packages/ui`, `cd backend && go test ./... && golangci-lint run` (clean except the pre-existing `main.go` SA1019), `cd agent && go test ./...`.
- **Hardware gate** (deferred to the user's ZD410, not a task blocker): confirm center is centered at `^BY2`/`^BY3`, a `^BY2` code scans, an over-long code overflows + warns. Recorded in the ledger.

---

### Task 1: Panel generator — computed module width + `^BY` emission

**Files:**
- Modify: `panel/src/features/badge/zpl/generateZpl.ts` (constants ~323-343, `estimateBarcodeWidthDots` 340-343, `barcodeFieldOrigin` 372-389, `generateBarcodeZPL` 395-418)
- Test: `panel/src/features/badge/zpl/generateZpl.test.ts`, `panel/src/features/badge/zpl/goldenMatrix.test.ts`

**Interfaces:**
- Produces (consumed by Task 2's Go twin as the spec to mirror, and by Task 3's UI):

```ts
// exported from generateZpl.ts
export const BARCODE_QUIET_MODULES = 10;
export const BARCODE_MIN_MODULE_DOTS = 2;
export const BARCODE_MAX_MODULE_DOTS = 3;
export function barcodeFootprintModules(dataLength: number): number; // (len+2)*11+13 + 2*QUIET
export function barcodeModuleWidthDots(dataLength: number, zoneWidthDots: number): number; // clamp(floor(zoneW/footprint), MIN, MAX)
export function barcodeOverflows(dataLength: number, zoneWidthDots: number): boolean;
// barcodeFieldOrigin return type GAINS two fields (existing fields unchanged):
//   { x, rightJustified, estimatedWidthDots, moduleWidthDots, overflows }
```

- [ ] **Step 1: Write the failing tests** — add to `generateZpl.test.ts`:

```ts
import {
  barcodeFootprintModules, barcodeModuleWidthDots, barcodeOverflows, barcodeFieldOrigin,
  BARCODE_MIN_MODULE_DOTS, BARCODE_MAX_MODULE_DOTS,
} from "./generateZpl";

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
```

- [ ] **Step 2: Run to verify failure** — `cd panel && npx vitest run src/features/badge/zpl/generateZpl.test.ts` → FAIL (`barcodeFootprintModules` undefined, `moduleWidthDots` missing).

- [ ] **Step 3: Implement** in `generateZpl.ts`. Replace the constant + `estimateBarcodeWidthDots` block (323-343):

```ts
// Fit-to-width Code 128 (2026-07-20-badge-barcode-fit-to-width-design.md):
// the module width is COMPUTED from the zone and data length and emitted as an
// explicit ^BY, so the estimate and the real print use the identical width --
// superseding PR #90's fixed-2 assumption, which broke on any printer whose
// persisted ^BY default wasn't 2 (the ZD410 center-shift bug). Both this file
// and its backend/zpl.go twin share these constants verbatim.
export const BARCODE_QUIET_MODULES = 10; // Code 128 min quiet zone, each side
export const BARCODE_MIN_MODULE_DOTS = 2; // reliable-scan floor @203dpi
export const BARCODE_MAX_MODULE_DOTS = 3; // short-code ceiling

// Total footprint in modules INCLUDING quiet zones -- the fit calc, so bars
// plus their required margins fit the zone.
export function barcodeFootprintModules(dataLength: number): number {
  return (dataLength + 2) * 11 + 13 + 2 * BARCODE_QUIET_MODULES;
}

// Bar-only module count -- the centering estimate; quiet zones are layout
// margin, not part of the ^FO-anchored symbol width.
function barcodeFootprintBarModules(dataLength: number): number {
  return (dataLength + 2) * 11 + 13;
}

export function barcodeModuleWidthDots(dataLength: number, zoneWidthDots: number): number {
  const fit = Math.floor(zoneWidthDots / barcodeFootprintModules(dataLength));
  return Math.min(BARCODE_MAX_MODULE_DOTS, Math.max(BARCODE_MIN_MODULE_DOTS, fit));
}

// True when the code can't fit its zone even at the readability floor -- the
// panel surfaces an advisory warning; zpl.go ignores it (best-effort print).
export function barcodeOverflows(dataLength: number, zoneWidthDots: number): boolean {
  return barcodeFootprintModules(dataLength) * BARCODE_MIN_MODULE_DOTS > zoneWidthDots;
}

// Estimated rendered BAR width in dots, using the COMPUTED module width so the
// ^FO centering below matches the emitted ^BY. Residual: numeric runs pack two
// digits per symbol under Code Set C, so a numeric-heavy code prints slightly
// NARROWER than this -- a small, bounded left bias, not the old unbounded
// printer-^BY-state error.
export function estimateBarcodeWidthDots(dataLength: number, moduleWidthDots: number): number {
  return barcodeFootprintBarModules(dataLength) * moduleWidthDots;
}
```

Rewrite `barcodeFieldOrigin` (372-389) to compute the module width and return it plus `overflows`:

```ts
export function barcodeFieldOrigin(
  element: Pick<RawBadgeElement, "x" | "width" | "align">,
  dpi: number,
  dataLength: number,
): { x: number; rightJustified: boolean; estimatedWidthDots: number; moduleWidthDots: number; overflows: boolean } {
  const zoneLeftDots = mmToDots(element.x, dpi);
  const zoneWidthDots = mmToDots(element.width || 30, dpi);
  const moduleWidthDots = barcodeModuleWidthDots(dataLength, zoneWidthDots);
  const estimatedWidthDots = estimateBarcodeWidthDots(dataLength, moduleWidthDots);
  const overflows = barcodeOverflows(dataLength, zoneWidthDots);

  if (element.align === "right") {
    return { x: zoneLeftDots + zoneWidthDots, rightJustified: true, estimatedWidthDots, moduleWidthDots, overflows };
  }
  if (element.align === "center") {
    const offset = Math.max(0, Math.round((zoneWidthDots - estimatedWidthDots) / 2));
    return { x: zoneLeftDots + offset, rightJustified: false, estimatedWidthDots, moduleWidthDots, overflows };
  }
  return { x: zoneLeftDots, rightJustified: false, estimatedWidthDots, moduleWidthDots, overflows };
}
```

In `generateBarcodeZPL` (395-418), prepend `^BY`:

```ts
  const origin = barcodeFieldOrigin(element, dpi, barcodeData.length);
  const foSuffix = origin.rightJustified ? ",1" : "";

  // ^BY sets the module width for the barcode that follows -- emitted
  // explicitly so the print width equals estimateBarcodeWidthDots's assumption
  // (fit-to-width design). Persistent modal command, but this label has one
  // barcode and ^BY immediately precedes it, so there's no cross-element leak.
  return `^BY${origin.moduleWidthDots}^FO${origin.x},${y}${foSuffix}^BCN,${height},${interpretationLine},N,N^FD${escapeZplData(barcodeData)}^FS`;
```

Note the `estimateBarcodeWidthDots` call site inside `ZplPreviewModal.tsx` — it imports `barcodeFieldOrigin` and reads `origin.estimatedWidthDots` only (already), so it needs NO change; but grep for any OTHER caller of the old single-arg `estimateBarcodeWidthDots` and update it (there should be none outside this file after the signature change — verify with `grep -rn estimateBarcodeWidthDots panel/src`).

- [ ] **Step 4: Run the new tests** — `npx vitest run src/features/badge/zpl/generateZpl.test.ts` → PASS.

- [ ] **Step 5: Regenerate the panel golden matrix** — `goldenMatrix.test.ts`'s barcode-bearing expected strings now carry a `^BY{n}` prefix. Run `npx vitest run src/features/badge/zpl/goldenMatrix.test.ts`, read each failing expectation's `Received` value, and update the expected constant to match ONLY where the sole diff is the new `^BY` prefix + any center-x shift (verify each diff is exactly that — a diff anywhere else means a real regression, stop). Re-run → PASS.

- [ ] **Step 6: Full panel suite + gates** — `cd .. && npm run test -w panel && npm run typecheck -w panel && (cd panel && npx eslint .)`. ZplPreviewModal must still compile and its tests pass (the origin gained fields, lost none).

- [ ] **Step 7: Commit**

```bash
git add panel/src/features/badge/zpl/generateZpl.ts panel/src/features/badge/zpl/generateZpl.test.ts panel/src/features/badge/zpl/goldenMatrix.test.ts
git commit -m "panel: fit-to-width barcode — computed module width + explicit ^BY"
```

---

### Task 2: Backend Go twin — mirror the panel generator exactly

**Files:**
- Modify: `backend/internal/zpl/zpl.go` (constant 252, `estimateBarcodeWidthDots` 264-267, `barcodeFieldOrigin` 276-292, `generateBarcodeZPL` ~332)
- Test: `backend/internal/zpl/zpl_test.go`

**Interfaces:**
- Consumes: Task 1's exact formulas + constants (`QUIET=10`, `MIN=2`, `MAX=3`, footprint = `(len+2)*11+13+20`, bar = `(len+2)*11+13`, `moduleWidth = clamp(floor(zoneW/footprint), 2, 3)`, `overflows = footprint*2 > zoneW`).
- Produces: byte-identical ZPL to the panel generator for the same element+data+dpi.

- [ ] **Step 1: Write failing tests** — add to `zpl_test.go` (match the package's existing `TestGenerate…` table-test idiom — read one first):

```go
func TestBarcodeModuleWidth(t *testing.T) {
	cases := []struct {
		name       string
		dataLen    int
		zoneWidth  int
		wantWidth  int
		wantOverflow bool
	}{
		{"short code wide zone caps at MAX", 10, 795, 3, false},
		{"medium code fits at floor", 30, 795, 2, false},
		{"uuid clamps up to floor and overflows", 36, 795, 2, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := barcodeModuleWidthDots(c.dataLen, c.zoneWidth); got != c.wantWidth {
				t.Errorf("moduleWidth = %d, want %d", got, c.wantWidth)
			}
			if got := barcodeOverflows(c.dataLen, c.zoneWidth); got != c.wantOverflow {
				t.Errorf("overflows = %v, want %v", got, c.wantOverflow)
			}
		})
	}
}

func TestGenerateBarcodeZPL_EmitsBYAndCenters(t *testing.T) {
	el := BadgeElement{Type: "barcode", Source: "code", X: 0.5, Y: 37, Width: 99.5, Height: 17.5, Align: "center"}
	got := generateBarcodeZPL(el, map[string]any{"code": "QA-EN-0001"}, 203)
	// module width capped to 3; center x = 4 + round((795 - 145*3)/2) = 184
	if !strings.Contains(got, "^BY3^FO184,") {
		t.Errorf("missing ^BY3^FO184 prefix: %s", got)
	}
}
```

(Confirm `generateBarcodeZPL`'s data-map type — the file uses `map[string]any` or similar via `getDataString`; match the real signature, and use the real exported/unexported name.)

- [ ] **Step 2: Run to verify failure** — `cd backend && go test ./internal/zpl/ -run 'TestBarcodeModuleWidth|TestGenerateBarcodeZPL_EmitsBY' -v` → FAIL (undefined).

- [ ] **Step 3: Implement** — mirror Task 1. Replace the `barcodeModuleWidthDots` constant (252) with the computed functions:

```go
const (
	barcodeQuietModules = 10 // Code 128 min quiet zone, each side
	barcodeMinModuleDots = 2 // reliable-scan floor @203dpi
	barcodeMaxModuleDots = 3 // short-code ceiling
)

// footprint incl. quiet zones -- the fit calc. Mirrors
// panel/generateZpl.ts's barcodeFootprintModules exactly.
func barcodeFootprintModules(dataLength int) int {
	return (dataLength+2)*11 + 13 + 2*barcodeQuietModules
}

// bar-only module count -- the centering estimate.
func barcodeFootprintBarModules(dataLength int) int {
	return (dataLength+2)*11 + 13
}

func barcodeModuleWidthDots(dataLength, zoneWidthDots int) int {
	fit := zoneWidthDots / barcodeFootprintModules(dataLength) // integer floor
	if fit < barcodeMinModuleDots {
		return barcodeMinModuleDots
	}
	if fit > barcodeMaxModuleDots {
		return barcodeMaxModuleDots
	}
	return fit
}

func barcodeOverflows(dataLength, zoneWidthDots int) bool {
	return barcodeFootprintModules(dataLength)*barcodeMinModuleDots > zoneWidthDots
}

// estimated BAR width using the computed module width -- see the panel twin's
// comment on the Set-C residual.
func estimateBarcodeWidthDots(dataLength, moduleWidthDots int) int {
	return barcodeFootprintBarModules(dataLength) * moduleWidthDots
}
```

Rewrite `barcodeFieldOrigin` (276-292) to also return `moduleWidth` (Go multi-return; `overflows` is not needed by the Go print path, so DON'T add it — YAGNI — but DO compute the module width here so the caller emits `^BY`):

```go
func barcodeFieldOrigin(el BadgeElement, dpi, dataLength int) (x int, rightJustified bool, moduleWidthDots int) {
	zoneLeft := mmToDots(el.X, dpi)
	widthMM := el.Width
	if widthMM <= 0 {
		widthMM = 30
	}
	zoneWidth := mmToDots(widthMM, dpi)
	moduleWidthDots = barcodeModuleWidthDots(dataLength, zoneWidth)

	switch el.Align {
	case "right":
		return zoneLeft + zoneWidth, true, moduleWidthDots
	case "center":
		estimated := estimateBarcodeWidthDots(dataLength, moduleWidthDots)
		offset := int(math.Round(float64(zoneWidth-estimated) / 2))
		if offset < 0 {
			offset = 0
		}
		return zoneLeft + offset, false, moduleWidthDots
	default:
		return zoneLeft, false, moduleWidthDots
	}
}
```

In `generateBarcodeZPL` (~332), capture the third return and prepend `^BY`:

```go
	x, rightJustified, moduleWidth := barcodeFieldOrigin(el, dpi, utf8.RuneCountInString(barcodeData))
	...
	return fmt.Sprintf("^BY%d^FO%d,%d%s^BCN,%d,%s,N,N^FH^FD%s^FS", moduleWidth, x, y, foSuffix, height, interpretationLine, barcodeData)
```

(Keep the existing `^FH` — the Go generator's hex-escape flag — exactly where it is; only `^BY%d` is prepended.)

- [ ] **Step 4: Run the new tests** — `go test ./internal/zpl/ -run 'TestBarcode|TestGenerateBarcode' -v` → PASS.

- [ ] **Step 5: Update Go golden/parity tests** — any existing `zpl_test.go` case asserting a full barcode ZPL string now needs the `^BY{n}` prefix. Run `go test ./internal/zpl/`, update each failing expected string ONLY for the `^BY` prefix + center-x shift (verify each diff), re-run → PASS.

- [ ] **Step 6: Gates** — `go test ./... && golangci-lint run` (clean except pre-existing `main.go` SA1019). Confirm the panel↔Go parity by hand on one case: the panel test's `^BY3^FO184,…` and the Go test's `^BY3^FO184,…` for `QA-EN-0001` must match (the `^FH` placement is the only intentional Go-only difference).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/zpl/zpl.go backend/internal/zpl/zpl_test.go
git commit -m "backend: fit-to-width barcode — mirror panel module-width + ^BY (real print path)"
```

---

### Task 3: Panel UI — overflow advisory in PropertiesPane

**Files:**
- Modify: `panel/src/features/badge/PropertiesPane.tsx` (props interface ~23-52; barcode section ~459/582), `panel/src/features/badge/BadgeEditorPage.tsx` (PropertiesPane invocation ~762-770), `panel/src/shared/i18n/en.json`, `panel/src/shared/i18n/ru.json`
- Test: `panel/src/features/badge/PropertiesPane.test.tsx`

**Interfaces:**
- Consumes: `barcodeFieldOrigin(element, dpi, dataLength).overflows` (Task 1); `resolveElementText` (from `./canvasMath`, already imported by the generator — import into PropertiesPane).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test** — add to `PropertiesPane.test.tsx` (match its render harness — read one existing barcode/text test first for the props it passes):

```ts
it("shows the overflow advisory for a barcode whose preview code can't fit readably", () => {
  renderPane({
    element: { id: "b", type: "barcode", source: "code", x: 0.5, y: 37, width: 40, height: 17.5, align: "center" },
    config: { width_mm: 100, height_mm: 60, dpi: 203 },
    previewData: { code: "550e8400-e29b-41d4-a716-446655440000" }, // a UUID
  });
  expect(screen.getByText(/QR/i)).toBeInTheDocument(); // the guidance mentions QR
});

it("hides the advisory when the barcode fits", () => {
  renderPane({
    element: { id: "b", type: "barcode", source: "code", x: 0.5, y: 37, width: 99.5, height: 17.5, align: "center" },
    config: { width_mm: 100, height_mm: 60, dpi: 203 },
    previewData: { code: "QA-EN-0001" },
  });
  expect(screen.queryByText(/QR/i)).not.toBeInTheDocument();
});

it("never shows the advisory for a non-barcode element", () => {
  renderPane({
    element: { id: "t", type: "text", source: "first_name", x: 0, y: 0, width: 99, height: 14 },
    config: { width_mm: 100, height_mm: 60, dpi: 203 },
    previewData: { first_name: "550e8400-e29b-41d4-a716-446655440000" },
  });
  expect(screen.queryByText(/QR/i)).not.toBeInTheDocument();
});
```

(If `renderPane` doesn't already accept `previewData`, extend the test helper to pass it as a prop; the component prop is added in Step 3.)

- [ ] **Step 2: Run to verify failure** — `cd panel && npx vitest run src/features/badge/PropertiesPane.test.tsx` → FAIL (`previewData` not a prop / advisory absent).

- [ ] **Step 3: Implement.**
  - `PropertiesPaneProps` gains: `previewData: Record<string, string>;` (doc comment: "the previewed attendee's data — same `preview.data` ZplPreviewModal/BadgeCanvas receive — used to length-check a barcode's resolved code for the overflow advisory").
  - `BadgeEditorPage.tsx`'s PropertiesPane invocation gains `previewData={preview.data}`.
  - In PropertiesPane, import `resolveElementText` from `./canvasMath` and `barcodeFieldOrigin` from `./zpl/generateZpl`. Compute (near the other derived values ~372):

```tsx
  // Advisory only: a barcode whose resolved code can't fit its zone at the
  // readability floor (^BY2). Non-blocking -- guides long values to the QR
  // element (the compact answer; linear symbologies are wider). Recomputes
  // when the previewed persona changes (previewData is that reactive input).
  const barcodeOverflow =
    isBarcodeType &&
    barcodeFieldOrigin(element!, config.dpi, resolveElementText(element!, previewData).length).overflows;
```

  Render the advisory right after the barcode caption switch (~590), reusing the `text-warning` advisory idiom:

```tsx
      {isBarcodeType && barcodeOverflow && (
        <p role="alert" className="text-caption text-warning">
          {t("badgeBarcodeOverflow")}
        </p>
      )}
```

  - i18n `en.json`: `"badgeBarcodeOverflow": "This code is longer than fits as a readable barcode at this width. For long values (e.g. a UUID), use a QR element instead."`
  - i18n `ru.json`: `"badgeBarcodeOverflow": "Этот код длиннее, чем помещается читаемым штрих-кодом при такой ширине. Для длинных значений (например, UUID) используйте QR-код."`

- [ ] **Step 4: Run** — `npx vitest run src/features/badge/PropertiesPane.test.tsx` → PASS.

- [ ] **Step 5: Full suite + gates** — `cd .. && npm run test -w panel && npm run typecheck -w panel && (cd panel && npx eslint .) && npm run test -w panel -- keyParity`.

- [ ] **Step 6: Commit**

```bash
git add panel/src/features/badge/PropertiesPane.tsx panel/src/features/badge/BadgeEditorPage.tsx panel/src/shared/i18n/en.json panel/src/shared/i18n/ru.json panel/src/features/badge/PropertiesPane.test.tsx
git commit -m "panel: barcode overflow advisory — guide long codes to QR (non-blocking)"
```

---

### Task 4: Final sweep + ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Verify-only otherwise

- [ ] **Step 1: Full gate run** (from the worktree root):

```bash
npm run test -w panel && npm run typecheck -w panel && (cd panel && npx eslint .) && npm run build -w panel
npm run test -w packages/ui
cd backend && go test ./... && golangci-lint run && cd ..
cd agent && go test ./... && cd ..
```

  Record exact pass counts; `golangci-lint` clean except the pre-existing `main.go` SA1019 (confirm `git diff main -- backend/main.go` is empty).

- [ ] **Step 2: Parity proof** — grep-confirm both generators carry the same constants and emit `^BY`: `grep -n "barcodeQuietModules\|BARCODE_QUIET_MODULES\|\^BY" panel/src/features/badge/zpl/generateZpl.ts backend/internal/zpl/zpl.go`. Confirm the `QA-EN-0001` center case produces `^BY3^FO184` in BOTH the panel test and the Go test (cite the two test names).

- [ ] **Step 3: Ledger** — append the fit-to-width execution record to `.superpowers/sdd/progress.md` (per-task commits, gate numbers, the still-open hardware gate on the ZD410).

- [ ] **Step 4: Commit** — `git add .superpowers/sdd/progress.md && git commit -m "docs(sdd): record fit-to-width barcode execution trail"` → then finishing-a-development-branch (PR; body notes it supersedes PR #90's fixed-module-width assumption and flags the ZD410 density/scannability re-verification as the merge-time hardware gate).
