# Badge editor: barcode element alignment (left/center/right)

## Problem

The 2026-07-20 Zebra printed-matrix run found that barcode elements define a
width zone (`element.width`, currently unused by generation) but Code 128's
rendered width depends on the encoded data, and the bars always pin to the
zone's left edge (`generateBarcodeZPL` emits a plain `^FOx,y`). Text elements
already support `align: "left" | "center" | "right"` via `^FB` (native) or a
computed raster offset (`rasterFieldOrigin`, added in PR #88). Barcode
elements have no equivalent.

## Scope

Two ZPL generators exist in this codebase and must both change, or the panel
editor's preview/test-print would silently disagree with what a real
check-in badge prints:

- **Panel (TypeScript):** [panel/src/features/badge/zpl/generateZpl.ts](../../../panel/src/features/badge/zpl/generateZpl.ts) — used by the panel's ZPL preview tab and test-print action.
- **Backend (Go):** `backend/internal/zpl/zpl.go` — the ONLY generator the
  real check-in/reprint print path calls (confirmed: no kiosk-specific or
  legacy duplicate generator exists anywhere in `backend/`). This is the same
  pattern already established by `showCaption` (PR #87), which shipped in
  both generators for the same reason.

Both generators already have an unused `Align`/`align` field on their
`BadgeElement` (Go: `zpl.go:31`, TS: `templateTypes.ts:27`) — it's read today
only by `generateTextZPL`. No new field, no schema migration, no backend
JSON-decoding change needed (both decoders already silently ignore unknown
keys; `align` isn't even unknown, it's simply unread for barcode today).

Also updated for print-accuracy parity, following the same principle PR #88
established for raster text ("the preview can never disagree with what
actually prints"):

- **[ZplPreviewModal.tsx](../../../panel/src/features/badge/ZplPreviewModal.tsx)**'s canvas `drawElement` barcode case — shifts the striped
  placeholder's start-x by the same offset the real ZPL uses.

**Explicitly out of scope:**

- **BadgeCanvas.tsx**'s editor-canvas barcode placeholder. That placeholder
  already fills its own bounding box edge-to-edge (the box itself is already
  positioned/sized at the element's x/y/width/height by the canvas's
  drag/resize system) — there is no separate "zone vs. content" distinction
  to visualize there, unlike `ZplPreviewModal`'s single shared canvas. Adding
  a visual shift here would require faking a narrower rendered barcode width
  with no real Code128 rendering to back it, which is exactly the kind of
  YAGNI the existing "no barcode-rendering lib in this repo" comment already
  rules out.
- i18n: `badgePropsAlignment` / `badgeAlignLeft` / `badgeAlignCenter` /
  `badgeAlignRight` already exist in both `en.json` and `ru.json` (added for
  text elements) — reused verbatim, no new keys.

## Alignment mechanism

Three cases, decided per the trade-off below (evaluated per the task's own
request to weigh `^FO`'s native justification parameter against a computed
offset, and pick whichever is verifiable on real hardware):

- **`left`** (default / field absent): **unchanged.** `^FOx,y` exactly as
  today — byte-identical output for every template saved before this field
  existed or that never sets `align` on a barcode element.
- **`right`**: use ZPL's native `^FOx,y,z` justification parameter (`z=1`).
  `x` is set to the zone's *right* edge (`zoneLeftDots + zoneWidthDots`); the
  printer itself computes the barcode's true rendered width at print time and
  grows it leftward from that point. This has **zero estimation error** —
  it delegates the one genuinely hardware-dependent computation (actual
  Code 128 symbol width, which varies with Code Set A/B/C subset-switching)
  to the printer's own firmware, which is exactly why it's preferred over
  computing an offset for this case.
- **`center`**: `^FO`'s justification parameter has no center option (`z=2`
  is "auto", for bidirectional text direction — not center alignment), so
  this case is computed: an estimated symbol width, then
  `x = zoneLeftDots + max(0, (zoneWidthDots - estimatedWidthDots) / 2)`
  with left justification (`z=0`/omitted) at that computed `x`.

  Estimate formula (documented assumption, to be confirmed on the physical
  Zebra ZD421 in the next printed-matrix run — same hardware-verification
  gate this whole initiative already uses):
  `estimatedWidthDots = moduleWidthDots * ((numChars + 2) * 11 + 13)`
  - `(numChars + 2) * 11 + 13` is Code 128's standard module-count formula
    (11 modules per symbol character, uniform across subsets A/B/C; `+2` for
    the start and checksum characters; `+13` for the wider stop character).
  - This assumes one symbol character per input character (Code Set B).
    All-numeric data may be packed two-digits-per-symbol-character under
    Code Set C by the printer's own auto-subset-selection, which would make
    the true rendered width *narrower* than this estimate — the estimate is
    a documented upper bound for numeric-heavy payloads, not an exact value.
  - `moduleWidthDots = 2`: neither generator ever emits `^BY` (module-width
    command), so the printer's own factory default applies (Zebra ZPL II
    default: module width 2 dots, bar ratio 3.0) — this is a real hardware
    default, not an invented constant, but only holds as long as neither
    generator starts emitting `^BY` elsewhere.

  Both generators note this limitation at the `estimatedWidthDots`
  computation, and the PR description flags it for confirmation on hardware.

## Zone width

`element.width ?? 30` (mm), consistent with the **existing** fallback already
used in three places for barcode: `canvasMath.ts`'s `DEFAULT_SIZE_MM.barcode`,
and `ZplPreviewModal.tsx`'s `drawElement` barcode case
(`mmToDots(element.width || 30, config.dpi)`). `generateBarcodeZPL` doesn't
read `width` at all today (unlike QR/text), so reading it for the alignment
zone is a new but precedent-matching addition, not a behavior change to
anything currently working.

## Shared helper

Mirrors the `rasterFieldOrigin` pattern already established by PR #88: a
pure, exported function computing `{x, justification}` (the `^FO` x
coordinate and its `z` argument, `0` or `1`) for a barcode element, so
`generateBarcodeZPL` and `ZplPreviewModal`'s `drawElement` call the exact same
logic and can never drift apart. Suggested name: `barcodeFieldOrigin` (TS)
with a Go equivalent in `zpl.go`.

## UI

`PropertiesPane.tsx`'s `ALIGN_OPTIONS` button group (currently rendered only
inside the `isTextType &&` block, ~line 341-366) is extracted to a shared
condition covering `text` and `barcode` (not `qrcode`/`line`/`box`) — the same
`hasBindingSection`-style pattern already used one section above it for
`text || qrcode || barcode`.

## Testing

- `generateZpl.test.ts`: unit cases for barcode `align: "left"/"center"/
  "right"/undefined`, at multiple `width`s and one no-`width` (30mm fallback)
  case.
- `goldenMatrix.test.ts`: extend the existing barcode fixture cell(s) with an
  aligned variant.
- Go `zpl_test.go`: mirrored cases for parity with the TS suite.
- `PropertiesPane.test.tsx`: alignment buttons render and dispatch `align`
  for a selected barcode element (not just text).
- `i18n/keyParity.test.ts`: no change expected (no new keys), left as a
  regression guard.
- `ZplPreviewModal.tsx`'s canvas draw offset: same as the existing raster
  align/valign precedent (PR #88) — not asserted by an automated test
  (jsdom has no 2D canvas context), verified manually per that file's own
  documented convention.
