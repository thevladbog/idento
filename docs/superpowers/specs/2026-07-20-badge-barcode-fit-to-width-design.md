# Badge barcode: fit-to-width Code 128 (computed module width + explicit `^BY`)

## Problem

The 2026-07-20 Zebra printed-matrix run (ZD410, 203 dpi) printed a barcode
configured `align: "center"` visibly shifted to the right edge. Root cause,
traced to the exact generated ZPL (`^FO257,296^BCN,140,Y,N,N`) against the
saved template (barcode `x=0.5mm w=99.5mm align=center` on a 100 mm label):

- Center alignment (PR #90) positions the barcode using
  `estimateBarcodeWidthDots`, which **hardcodes module width = 2 dots** — the
  Zebra factory default — because neither generator ever emits `^BY`.
- But with no `^BY`, the printer uses its **own persisted `^BY` state**, which
  on this ZD410 is wider than 2 (≈3). The real barcode is ~1.5× the estimate,
  so a placement computed for a 290-dot barcode holds a ~435-dot barcode →
  the whole symbol is pushed right of the zone's true center.

PR #90's own design doc flagged this exact fragility: *"`moduleWidthDots = 2`
… only holds as long as neither generator starts emitting `^BY`."* The
estimate is also blind to a second failure mode: a long code (a UUID is 36
chars ≈ 430 modules) **overflows the label** at any fixed module width —
`^BY2` alone is 862 dots ≈ 108 mm, past a 100 mm label edge.

## Goal

Make barcode width **deterministic and zone-aware**: compute the module width
from the zone width and the encoded-data length, emit it as an explicit `^BY`,
and use that same width for centering. This fixes the right-shift bug (the
estimate and the print now use the identical module width) and bounds the
overflow problem (module width scales down to fit, within a readability
floor). No printer-state dependency remains.

## Decisions (user-approved during brainstorm, 2026-07-20)

1. **Readability over fit.** Module width never drops below `^BY2` (the
   reliable-scan floor at 203 dpi). A code that cannot fit its zone at `^BY2`
   is allowed to overflow, and an **advisory** warning fires — it does NOT
   shrink to an unscannable `^BY1`.
2. **Ceiling `^BY3`.** A short code in a wide zone is not stretched into a
   giant barcode; module width caps at 3 and the (narrower-than-zone) symbol
   is positioned by `align` within the zone.
3. **Advisory, non-blocking warning.** When the code cannot fit readably, a
   warning renders in `PropertiesPane` for the selected barcode element,
   guiding the operator to use the QR element for long values. It never blocks
   save or print. (The real check-in print path — `zpl.go` — has no UI and
   prints best-effort; the warning is a design-time aid only.)
4. **No symbology switcher.** Code 39 / 93 are WIDER than Code 128 for
   alphanumeric data (measured: Code 39 ≈ 500 modules for a UUID vs Code 128's
   ≈ 430), so they do not solve the density problem; the only compact answer
   for long data is a 2D code, and the template already has a `qrcode`
   element. Symbology selection is explicitly out of scope and deferred with
   no committed follow-up.

## Module-width computation

Single source of truth, mirrored byte-for-byte across both generators (the
same dual-generator discipline `showCaption` (PR #87) and `barcodeFieldOrigin`
(PR #90) already follow — `zpl.go` is the ONLY generator the real check-in /
reprint path calls; the panel generator drives preview + test-print):

```
QUIET_MODULES  = 10            // Code 128 min quiet zone, each side
MIN_MODULE_DOTS = 2            // reliable-scan floor @203dpi
MAX_MODULE_DOTS = 3            // short-code ceiling

footprintModules(len) = (len + 2) * 11 + 13 + 2 * QUIET_MODULES
   // (len+2)*11 : start + data + checksum, 11 modules each (uniform A/B/C)
   // +13        : the wider stop character
   // +2*10      : quiet zones both sides, so bars + margins fit the zone

barcodeModuleWidthDots(len, zoneWidthDots) =
   clamp( floor(zoneWidthDots / footprintModules(len)), MIN_MODULE_DOTS, MAX_MODULE_DOTS )

barcodeOverflows(len, zoneWidthDots) =
   footprintModules(len) * MIN_MODULE_DOTS > zoneWidthDots
   // true ⇒ can't fit even at the readability floor ⇒ warn + overflow
```

- `len` = the resolved barcode data's character count (the previewed
  attendee's `code` in the panel; the real attendee's `code` in `zpl.go`).
  Uses the same `resolveElementText` the generators already call.
- `zoneWidthDots = mmToDots(element.width ?? 30, dpi)` — the `?? 30` fallback
  is the existing barcode default (`canvasMath.ts` `DEFAULT_SIZE_MM.barcode`,
  and `ZplPreviewModal`/`generateBarcodeZPL`'s current `element.width || 30`).
- `estimateBarcodeWidthDots` becomes
  `footprintBarModules(len) * barcodeModuleWidthDots(len, zoneWidthDots)`
  where `footprintBarModules(len) = (len+2)*11 + 13` (bars only, no quiet
  zones — the quiet zones are layout margin, not part of the `^FO`-anchored
  symbol width used for centering). Because the same computed module width now
  feeds BOTH the emitted `^BY` and this estimate, center placement is exact up
  to the residual **Set C** effect only (numeric runs pack two digits per
  symbol character, so a numeric-heavy code prints slightly NARROWER than the
  Set-B estimate → a small, bounded left bias, documented at the call site —
  not the previous unbounded printer-state error).

## ZPL emission

`generateBarcodeZPL` (both generators) prepends `^BY{moduleWidth}` to the
existing `^FO…^BCN,…` string:

```
^BY{mw}^FO{x},{y}{,1 if right}^BCN,{height},{Y|N},N,N^FD{data}^FS
```

- `^BY` is a **persistent** ZPL modal command — it changes the printer's
  module width for every subsequent barcode in the label until reset. This
  label format has exactly one linear barcode, and `^BY` is emitted
  immediately before it, so there is no cross-element leakage within a label;
  across labels, each `^XA…^XZ` re-emits its own `^BY`. (If a future template
  ever supports multiple barcodes, each must emit its own `^BY` — noted for
  that future work, not built now.)
- `align` handling is otherwise UNCHANGED from PR #90's `barcodeFieldOrigin`:
  `left` = zone-left `^FO`; `right` = zone-right `^FO…,1` native
  justification (still zero-error — the printer grows the symbol left from the
  right edge at the now-known `^BY` width); `center` = computed
  `zoneLeft + (zoneWidth − estimateBarcodeWidthDots)/2`, clamped `≥ 0`.

## Shared helper shape

`barcodeFieldOrigin` (TS + Go twin) already returns
`{ x, rightJustified, estimatedWidthDots }`. It gains the computed module
width so callers (generator + preview) never recompute or drift:

```
barcodeFieldOrigin(element, dpi, dataLength) ->
  { x, rightJustified, estimatedWidthDots, moduleWidthDots, overflows }
```

- `moduleWidthDots` — emitted as `^BY` by `generateBarcodeZPL`.
- `overflows` — consumed by the panel UI warning; ignored by `zpl.go`
  (best-effort print).
- `estimatedWidthDots` now derives from `moduleWidthDots` (not the fixed 2).

## Preview parity

`ZplPreviewModal.tsx`'s `drawElement` barcode case already draws the striped
placeholder at `origin.estimatedWidthDots` starting at `origin.x` (PR #90).
Because `estimatedWidthDots` now reflects the computed module width, the
placeholder automatically tracks the real print width — no separate change to
the draw code beyond consuming the updated `origin`. The Rendered tab stays a
jsdom-untestable canvas (documented convention; verified on hardware).

`BadgeCanvas.tsx` (the editor drag/resize canvas) stays out of scope for the
same reason PR #90 excluded it: its placeholder fills the element's own
bounding box, which is not a "zone vs. rendered width" surface.

## UI — overflow warning

- A new advisory line renders inside `PropertiesPane` for a selected
  `barcode` element when `barcodeFieldOrigin(...).overflows` is true for the
  current preview attendee's code. Placement: directly under the barcode
  align/width controls (the element-scoped section PR #90 added).
- Copy (i18n, EN + RU, new keys): EN
  `"This code is longer than fits as a readable barcode at this width. For
  long values (e.g. a UUID), use a QR element instead."` — RU: natural
  translation («Этот код длиннее, чем помещается читаемым штрих-кодом при
  такой ширине. Для длинных значений (например, UUID) используйте QR-код.»).
- Styling: the `text-warning` amber advisory idiom already used for the
  fonts-not-ready notice; never color-alone (the text itself carries the
  meaning). Does not disable Save/print.
- The warning depends on the previewed attendee's code length; switching the
  preview persona recomputes it (same reactive data the barcode preview
  already reads).

## Testing

- **`generateZpl.test.ts`** + **`zpl_test.go`** (parity): `barcodeModuleWidth`
  / `footprintModules` unit cases — short code in a wide zone (caps at
  `^BY3`), medium code (`^BY2`), long code that overflows (`^BY2`,
  `overflows=true`); the emitted `^BY{n}` prefix present and correct;
  `align: left/center/right/absent` each at ≥2 widths; a numeric-heavy vs
  alpha code both centering with the documented Set-C caveat noted (not
  asserted as pixel-exact — it's the acknowledged residual).
- **`goldenMatrix.test.ts`**: regenerated — every barcode-bearing golden cell
  now carries a `^BY` prefix; the byte-exactness discipline is preserved with
  the new expected strings. Go golden equivalents updated in lockstep.
- **`PropertiesPane.test.tsx`**: the overflow warning renders for a barcode
  element whose preview code overflows and is absent when it fits; not shown
  for text/qr/line/box; alignment/caption controls unaffected.
- **`i18n/keyParity.test.ts`**: the new warning key present in both locales.
- **Hardware gate** (the same printed-matrix exit criterion this initiative
  already uses): on the real ZD410, confirm center is visually centered at
  `^BY2` and `^BY3`, confirm a `^BY2` code scans, and eyeball an intentionally
  over-long code's overflow + warning. Recorded in the ledger.

## Out of scope

- Symbology selection (Code 39/93/DataMatrix) — deferred, no follow-up.
- Multiple barcodes per template (each would need its own `^BY`) — noted, not
  built.
- `BadgeCanvas.tsx` editor-canvas barcode placeholder — unchanged (PR #90
  precedent).
- Any schema/migration change — `align`/`width`/`showCaption` already exist;
  no new persisted field (module width is derived, never stored).
- Making center EXACT for numeric-heavy codes (simulating Set-C encoding) —
  the residual bias is small and bounded; YAGNI unless a future run shows it
  matters.
