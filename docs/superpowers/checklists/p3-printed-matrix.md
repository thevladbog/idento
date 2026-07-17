# P3.2 printed-matrix checklist — manual QA (PHASE EXIT criterion)

**Applies to:** panel branch `panel/p3.2-print-truth` (spec §7, §1/§9; plan Task 10).
**User decision (spec §1):** P3.2 is not done until this checklist has been run once, in full,
against a real Zebra printer via the local print agent, and the results recorded per
"Where to record results" below. There is no in-product test-matrix UI (spec §10 out-of-scope) —
this document IS the exit gate.

**Why manual:** the golden-ZPL matrix (`panel/src/features/badge/zpl/goldenMatrix.test.ts`) proves
the generated ZPL *bytes* are correct against a deterministic mock rasterizer — it can never prove
what a Zebra printer actually marks on a label (real font hinting, print head threshold behavior,
ribbon/media quality). Cyrillic printing is the parent-spec's hard preservation requirement; only a
physical label proves it still works after the P3.2 port. This checklist is the human half of the
proof the CI half (goldens) cannot provide.

## Prerequisites

- A real Zebra printer (the model this event is configured for, e.g. Zebra ZD421 — board 4a's
  caption) connected and reachable by the local print agent (`agent/` service running, printer
  attached via USB/network per its own setup).
- Open **Test print** and confirm the agent status shows **connected** (AgentStatus's green dot
  lives INSIDE the Test print dialog, not in the badge editor's top bar) — if disconnected, both
  "Test print" and the drawer/bulk print affordances are disabled per the reachability-gated
  idiom; fix connectivity before starting this checklist, don't work around it.
- An event with a badge template open in the editor (`/events/{eventId}/badge`) whose elements
  include (mirrors the golden fixture's semantics, spec §1/§9): text bound to `first_name`,
  `last_name`, `company` + a QR code bound to `code` + a line.
- Two attendees (or the sample-attendee switcher's persona) to preview:
  - **EN sample** — Latin name, e.g. "Anna Petrova".
  - **RU sample** — Cyrillic name, e.g. "Анна Петрова" (the board's own sample persona).
- At least one **uploaded event font** (.ttf) for the customFont cells, added via
  **Settings → Fonts** (`FontsCard.tsx` — pick a file, accept the license checkbox, wait for the
  upload to complete) — pick one flagged **"✓ Cyr"** (confirmed Cyrillic coverage) in the
  Properties font selector's "Event fonts" group so cells 3/4 are testing a font that's actually
  supposed to work, not a known-broken one.

## The 4-cell matrix

| Cell | Font mode | Language | Expect (per generateZpl's ported rules) |
|---|---|---|---|
| 1 | native font (e.g. "Scalable (0)", Properties → "Built-in ZPL — Latin only") | EN | Fully native `^A`/`^FB` path — no image rendering |
| 2 | native font | RU | Cyrillic name elements raster (image); Latin `company` element (if left as-is) still native — routing is per-element, not per-template |
| 3 | customFont (uploaded event font) | EN | ALL text elements raster, despite Latin text — a set customFont always wins |
| 4 | customFont (uploaded event font) | RU | ALL text elements raster (customFont AND Cyrillic both apply) |

For **each** of the 4 cells:

1. In the editor's Properties inspector, select each text element (first name / last name /
   company) and set its font per the cell's "Font mode" column (native cells: pick a built-in
   "Built-in ZPL — Latin only" entry; customFont cells: pick the uploaded event font from
   "Event fonts").
2. Switch the preview attendee to the cell's language sample (PreviewPicker — search/pick the
   EN or RU attendee, or the sample persona if the event has none).
3. Open **"ZPL preview"** (top bar) → confirm the **"ZPL code"** tab shows the generated string,
   then switch to **"Rendered"** tab (see the dedicated Rendered-tab section below).
4. Open **"Test print"** (top bar) → confirm AgentStatus reads **"Print agent connected"** and the
   printer selector shows the expected default → click **"Print test badge"** → confirm the
   dialog's success line reads "Sent to {{printer}}" (this is a TRANSPORT ack only — the agent's
   `/print` 200 means bytes were handed to the printer, not that printing succeeded; that's what
   the rest of this checklist verifies).
5. Retrieve the physical label from the printer and verify against the per-cell points below.
6. Record pass/fail + notes for this cell before moving to the next (don't batch all 4 prints
   before checking any of them — a systemic issue should stop the run early).

### Per-cell verification points (on the physical label)

- **Cyrillic glyphs correct** (cells 2 & 4): compare each printed letter against the on-screen
  preview/expected name, character by character. Pay special attention to shapes that commonly
  break in font pipelines: **А, Я, Ё, Ж, Щ, ы, ё, я**.
- **No tofu**: no replacement boxes (☐), blank glyphs, or missing characters anywhere on the label.
- **QR scans**: scan the printed QR with a phone camera or barcode scanner app; confirm it decodes
  to the exact `code` value used for that attendee (not truncated, not garbled).
- **Alignment**: element positions match the template's mm coordinates — check with a ruler against
  the label's physical edges (90 × 55 mm per the fixture); no element clipped by the label edge or
  overlapping another.
- **Threshold/raster artifacts readable** (cells 2's name elements, and all text in cells 3/4):
  rasterized text uses a hard monochrome threshold with **no dithering** (by design — this is a
  preserved parity limitation, not a bug to fix in this flow). Confirm the printed text is still
  legible at normal reading distance despite the hard threshold; note (don't silently ignore) any
  stroke that's broken up or illegible.
- **Line element**: the `^GB` line prints as a single clean solid bar of the expected length and a
  thin, consistent thickness.
- **Native-path company text** (cell 1, and cell 2's company element if left on a native font):
  confirm it's crisp — built-in ZPL bitmap fonts are Latin-only by design (Properties selector's
  "Built-in ZPL — Latin only" note); this is expected, not a defect.

## Built-in vs. uploaded font verification

This cuts across the 4-cell matrix rather than adding new cells:

- **Cells 1–2 (built-in/native font):** confirm the printed Latin text visually matches a plain
  Zebra scalable-font look (no custom letterforms) — this is the printer's own resident font, never
  sent over the wire.
- **Cells 3–4 (uploaded event font):** confirm the printed text visually matches the UPLOADED
  font's actual letterforms (distinctive serifs/weights/etc., not a silent fallback to a generic
  system font). If the uploaded font's shape isn't obviously distinctive enough to eyeball with
  confidence, print one extra ad hoc label using a highly distinctive test face (e.g. a script or
  slab-serif .ttf) purely to confirm the rasterizer is actually drawing the uploaded font's glyphs
  and not silently substituting a fallback — this is exactly the failure mode the Task 2 Cyrillic
  coverage check exists to prevent (an uncovered font would otherwise print wrong Cyrillic glyphs
  with no signal).

## Rendered tab vs. physical output (human-verified here — Task 5's untestable canvas)

Task 5's ZPL-preview "Rendered" tab draws its composition on a real `<canvas>`, which jsdom has no
polyfill for. Task 5's own implementation report is explicit that the Rendered tab's actual
canvas-composition code ("`drawElement`, QR/barcode/native-text/raster-text drawing") is "not
exercised by any test" — jsdom's `getContext("2d")` is always `null`, so the modal deliberately
degrades to an honest error state instead of a fake pixel assertion; Task 8's report independently
notes the same jsdom canvas limitation as expected, pre-existing test-run noise (not a failure).
Both reports agree: no automated test anywhere in this codebase can verify Rendered-tab pixels.
This section is where that gap gets closed by a human:

1. For each of the 4 matrix cells (same font/language combination already printed above), open the
   ZPL preview modal and select the **"Rendered"** tab.
2. Hold the physical label next to the Rendered tab (same monitor, same attendee/cell) and compare
   them side by side.
3. Confirm the modal's own honesty captions are earning their keep:
   - Elements captioned as the **true raster** (raster-text elements — Cyrillic/customFont, drawn
     through the SAME rasterizer bitmap that was sent to the printer): these should match the
     physical label closely — same glyphs, same rough weight/spacing. A material mismatch here
     means the Rendered tab is lying about being "the truth" and is a real bug.
   - Elements captioned as an **approximation** (QR/line/native text — never rasterized, drawn via
     local re-implementations for the preview only): confirm these are recognizably similar but are
     NOT expected to be pixel-identical (e.g. QR module rendering style, exact line antialiasing).
     Do not flag cosmetic-only differences here as bugs.
4. Confirm no cell's Rendered tab renders silently blank/empty (an in-modal error line is fine and
   expected if a JS canvas genuinely can't be produced for some reason — a blank pane with no
   explanation is not).
5. Record any material (not cosmetic) mismatch between the Rendered tab and the physical label.

## Where to record results

Append a dated entry to the phase ledger `.superpowers/sdd/progress.md` (this file is intentionally
**not** committed to git this phase — see the Global constraints in the P3.2 plan) titled
**"P3.2 printed-matrix — manual QA"**, including:

- Printer model/firmware, agent version, date, who ran it.
- Each of the 4 cells: pass/fail + any notes from the per-cell verification points above.
- The built-in-vs-uploaded verification outcome.
- The Rendered-tab-vs-physical verification outcome (§ above).
- Any follow-up items filed as a result (e.g. a specific glyph that printed wrong, a threshold
  artifact worth revisiting later) — these are backlog candidates, not blockers to re-run this
  checklist, unless a cell outright failed (Cyrillic tofu, QR that doesn't scan, or a Rendered tab
  that materially lies about the print) — a failed cell blocks the P3.2 phase exit until re-verified.
