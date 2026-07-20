# Badge editor: document settings (width/height/dpi)

Date: 2026-07-20
Status: approved (compressed brainstorm — see rationale below)

## Problem

`BadgeConfig` (`width_mm`, `height_mm`, `dpi`) is set once, implicitly, when
a template is first created (`templateTypes.ts`'s `NEW_DOC_DEFAULT`, 90×55mm
@ 300dpi). The editor never exposes a way to change it on an *existing*
document. Found during the 2026-07-20 Zebra hardware run: a QA template was
created at 300dpi while the physical printer is a ZD410 (203dpi) — required
a raw API call to fix. This spec adds an in-editor surface for it.

## Approach: reuse PropertiesPane's empty state (not a new dialog)

Two placements were viable — a modal dialog off the top bar, or the
Properties pane's existing "nothing selected" branch (currently just
`badgePropsEmpty`'s muted hint). Going with the Properties pane:

- The right column is already the document's "inspector" surface; when
  nothing is selected, it currently shows nothing useful. Repurposing that
  real estate is more discoverable than a new top-bar button, and needs no
  new modal component (the editor already has four dialogs — Reload,
  Overwrite, Guard, plus two feature dialogs — a fifth for a rarely-changed
  setting isn't warranted).
- `PropertiesPane` already receives `config: BadgeConfig` as a prop for its
  clamp math; it's a natural extension for it to also let the operator edit
  that same config.

## Clamp behavior on shrink (not allow-offscreen)

When `width_mm`/`height_mm` shrinks below an existing element's position or
explicit size, elements clamp back into bounds immediately, using the exact
same `clampPosition`/`clampSize`/`elementFootprint` helpers every other
input path (drag, resize, keyboard nudge, typed X/Y/Width/Height in
`PropertiesPane`) already uses. Reasons:

- "Every element's x/y/width/height is always within `[0, width_mm] ×
  [0, height_mm]`" is already a load-bearing invariant enforced by all
  three existing interaction paths (`canvasMath.ts`'s own docs call this
  "one footprint rule ... across ALL input paths"). A config-driven shrink
  is a fourth path; breaking the invariant there would require new
  rendering support (an off-canvas visual indicator) that doesn't exist
  anywhere else in the stack — the artboard already clips with
  `overflow-hidden`, print/ZPL generation has no notion of "this element is
  off-label," and nothing currently reads such a flag.
- Clamping keeps the document always immediately printable, matching the
  codebase's existing "never invent/hide a value" ethos (e.g.
  `badgeCanvasApproximation`'s permanent honesty caption).
- Zero new clamp math — the reducer calls the same exported helpers.

A footprint-only element (e.g. a fresh `text` element with no explicit
`width`/`height`) only has its **position** reclamped; it is never given an
invented explicit width/height it didn't have before (mirrors how
`elementFootprint` is used everywhere else — as a fallback for computing
clamp bounds, never as a value silently written onto the element).

The behavior is disclosed via a static, always-visible caption next to the
fields (same pattern as `badgeCanvasApproximation`) rather than a dynamic
per-edit "N elements changed" notice — simpler, no new transient state, and
consistent with the editor's existing static-caption convention.

## Bounds

- `width_mm` / `height_mm`: `[10, 200]` — below 10mm nothing meaningful
  fits; above 200mm exceeds common desktop thermal label/badge stock (the
  equipment hub's registered printers are ZD-series Zebras). No backend
  bound exists (`zpl.ParseBadgeTemplate` only rejects `<= 0`), so this is a
  UI-only sanity rail, clamped client-side before dispatch.
- `dpi`: fixed picker `{203, 300, 600}` — the three resolutions
  `zpl.go`/`generateZpl.ts` handle correctly today (the pipeline's dpi
  arithmetic, `mmToDots`/`pointsToDots`, is a pure multiply — no code
  currently assumes only 203/300, confirmed by reading `generateZpl.ts` and
  `zpl.go`; a 600dpi golden case is added to prove it).

## Changes

- `editorState.ts`: new `{ type: "updateConfig"; patch: Partial<BadgeConfig> }`
  action. Merges the patch onto the doc's config fields, re-clamps every
  element per the rule above, sets `dirty: true`. No other reducer case
  changes.
- `PropertiesPane.tsx`: new `onUpdateConfig: (patch: Partial<BadgeConfig>) => void`
  prop. The `element === null` branch renders a "Document settings" section
  (width/height number inputs, dpi `<select>`, the shrink-behavior caption)
  instead of just the old hint; the old hint copy is kept but reworded to
  also point at this new section.
- `BadgeEditorPage.tsx`: wires `onUpdateConfig={(patch) => dispatch({ type: "updateConfig", patch })}`.
  Nothing else changes — save/dirty-guard/conflict machinery already
  operates generically on `state.doc`/`state.dirty`.
- i18n (`en.json`/`ru.json`): two new keys (`badgePropsDocTitle`,
  `badgePropsDpi`, `badgePropsDocShrinkHint` — three) plus a reworded
  `badgePropsEmpty`. Existing `badgePropsWidth`/`badgePropsHeight` labels
  are reused verbatim for the doc-level fields (mutually exclusive with the
  element branch, so no on-screen duplicate-label ambiguity); new DOM ids
  (`badge-props-doc-*`) avoid colliding with the element fields' ids.
- Tests: `editorState.test.ts` (`updateConfig` merge + clamp + no-invented-size
  cases), `PropertiesPane.test.tsx` (replace the "no form controls in empty
  state" assertion with the new fields + dispatch + bounds-clamp coverage),
  `BadgeEditorPage.test.tsx` (wiring marks the doc dirty), `goldenMatrix.test.ts`
  (one new 600dpi cell).

## Out of scope

- No new confirm/undo step before a shrink-triggered clamp (matches every
  other clamp path in this editor, none of which confirm either).
- No visual indicator for "would go off-canvas" — ruled out above.
- No backend/API changes — `BadgeConfig`/`ParseBadgeTemplate` already
  accept arbitrary positive width/height and any positive int dpi.

## Process note

This spec was authored from a fully-specified backlog note (this
codebase's own memory file, written by the user after the Zebra hardware
run) rather than through interactive back-and-forth — the requirements,
constraints, and even the two behavior options to choose between were
already stated. Brainstorming's exploration was done by reading the
existing editor architecture (`canvasMath.ts`, `editorState.ts`,
`PropertiesPane.tsx`, `zpl.go`) to ground the one open decision (clamp vs.
allow-offscreen) in what the codebase already guarantees, rather than by
asking the user to re-decide something they'd already scoped.
