# Panel P3 — Badge editor: three-pane shell, save model, print truth

**Date:** 2026-07-16 · **Status:** approved
**Parent spec:** `docs/superpowers/specs/2026-07-13-panel-rewrite-design.md` (§5 P3)
**Board extract:** `.superpowers/sdd/p3-board-4a-4d-extract.md` (screens 4a winner / 4b informative delta / 4c save states / 4d ZPL preview; shared 1a/1b)
**Design source (now in-repo):** `docs/design-briefs/idento-event-check-in-landing/project/Idento Panel.dc.html`
**Predecessors:** P0–P2 all merged (PRs #59/#60/#62/#63/#64/#65/#66 + follow-ups #67–#70).

## 1. Decomposition

Two sub-cycles, each its own plan → PR (mirrors P1/P2; keep each PR under ~50 changed files —
CodeRabbit's free tier skips larger PRs entirely, as happened on #66):

- **P3.1 "Editor & save model"** — branch `panel/p3.1-badge-editor`. Backend template
  storage/versioning (§3) + the editor route with three panes (§4) + save model & dirty guard
  (§5) + preview data (§6) + readiness/rail unlock (§8).
- **P3.2 "Print truth"** — branch `panel/p3.2-print-truth`. ZPL preview 4d, printer-font flow
  with Cyrillic coverage, test print via agent, and the P2-deferred print unlocks (§7) +
  golden-ZPL regression tests (§9).

**Phase exit criterion (manual QA, no product UI — user decision):** at P3.2 close, print the
test matrix — built-in printer fonts vs uploaded event fonts × RU/EN sample badges — on a real
Zebra via the agent, against the preserved raster path; record the results in the phase ledger.

## 2. Constraints carried forward (locked in P0–P2.2, enforced in review)

- openapi-first for every new/changed endpoint: `backend/openapi.yaml` → handler → kin-openapi
  contract test (coverage ledger under `OPENAPI_COVERAGE=1`) → `npm run generate:api -w panel`,
  CI drift-checks committed `schema.d.ts`.
- Panel data hooks via `$api` only; MSW (`startMswServer`) for new tests; `getRouteApi` for
  typed params; `router.tsx` regression guard (`/register` `beforeLoad` + `protectedBeforeLoad`
  byte-for-byte).
- i18n EN+RU with keyParity; no fabricated data (loading → Skeleton, error ≠ empty); WCAG 1.4.1;
  `@idento/ui` primitives, token classes only.
- Mutation hygiene: session-id refs, unconditional invalidation, typed-confirm stays open on
  failure, exhaustive busy-gating (multi-step dialogs audited up front), per-row pending `Set`s.
- **Readiness rule (post-#70, in `panel/AGENTS.md`):** any mutation changing what the readiness
  rail shows must invalidate `READINESS_KEY(eventId)` — saving a badge template changes the
  `badge` readiness step (backend `readiness.go` reads the badge template), so template save
  invalidates readiness unconditionally.
- **Cyrillic printing preservation (parent-spec hard requirement):** the truetype-raster → ZPL
  graphics path in `backend/internal/zpl` is not rewritten, only reused. Native-ZPL objects the
  board notes as "never rasterized" (QR via `^BQ`) stay native; text stays rastered. Any change
  to `zpl` package internals needs golden-test proof of byte-stable output (§9).
- QR/barcode/preview rendering is always local (backend or client) — never a 3rd-party API
  (no Labelary).

## 3. Backend additions (all in P3.1)

### 3.1 Template storage & versioning

Today the template lives in `event.custom_fields["badgeTemplate"]` (JSON blob parsed by
`zpl.ParseBadgeTemplate`, consumed by `POST /api/events/{id}/badge-zpl`). P3.1 promotes it:

- **Migration:** `badge_template JSONB NULL` + `badge_template_version INT NOT NULL DEFAULT 0`
  on `events`; one-time data migration copies any existing `custom_fields->>'badgeTemplate'`
  into the column (version 1) without deleting the legacy key (read-fallback keeps old clients
  working; the legacy key is never written again).
- **`GET /api/events/{id}/badge-template`** → `{template: object|null, version: int}`.
  `template: null, version: 0` when the event has none (never fabricate an empty template).
- **`PUT /api/events/{id}/badge-template`** body `{template: object, version: int}`:
  - validates `template` with the REAL parser (`zpl.ParseBadgeTemplate`) — 400 with the parser's
    message on invalid;
  - compares `version` to the stored one — **409** `{error, current_version}` on mismatch (this
    is the editor's Conflict state; it is a real server fact, not a client guess);
  - on match: stores, increments version, returns `{template, version}` (200).
- `badge_zpl.go` reads the column first, falls back to the legacy `custom_fields` key —
  kiosk/web/mobile consumers unchanged.
- **The template JSON format itself does not change.** The editor edits exactly the
  config+elements structure `ParseBadgeTemplate` already accepts. The supported element types,
  config fields (label size, dpi), and binding-token vocabulary are read off the parser at plan
  time and become the plan's ground truth — the editor exposes only what the format supports.

**Explicitly no other backend work in P3.1.** The ZPL-preview endpoint is P3.2 (§7.1).

## 4. Editor — route & three-pane shell (P3.1; board 4a, the winner)

Route `/events/$eventId/badge` — child of the workspace layout; rail `badge` step becomes a
live link (`active` union grows to include `"badge"`).

- **Top bar (editor-local, under the workspace chrome):** breadcrumb-ish title + the save-state
  pill (§5) + right-aligned actions: "Test print" and "ZPL preview" (both locked with the P2.2
  disabled-Button+lock idiom until P3.2 wires them) and "Save".
- **Left — Elements pane:** list of the template's elements top-to-bottom; each row = type icon,
  display name, bound token (mono, e.g. `{first_name}`, `{company}`, `{code}`); selected row
  highlighted in sync with the canvas. "+ Add" affordances per supported type (text / QR /
  zone-strip — final list from the format, §3.1). Text elements bind to standard attendee
  fields or the event's `field_schema` custom fields; remove per row.
- **Center — canvas:** neutral dark artboard (board: `#3f3f46`-family → token-mapped surface),
  badge rendered at a fixed screen scale from the template's physical config (board sample:
  "90 × 55 mm · 300 dpi · Zebra ZD421" caption). Elements are selectable (click), draggable,
  resizable via corner handles; position/size live in mm in the template. The canvas render is
  an EDITING aid — the "truth" render is 4d (P3.2); no pixel-fidelity claims in P3.1.
- **Right — Properties inspector:** props for the selected element by type. Text: content
  binding (dropdown of tokens), font (see below), size, alignment, overflow (shrink-to-fit /
  wrap — per board). QR: size, quiet zone, error-correction level (if the format carries them —
  plan-time). **Font selector** groups "Printer fonts" (built-in) and "Event fonts" (uploads
  from `handler/fonts.go`), each entry flagged for Cyrillic coverage ("Cyr ✓" / "no Cyr" per
  board 4a) — the coverage-check mechanic for uploaded TTFs is verified at plan time (parse the
  font's cmap server- or client-side; if neither is cheap, the flag ships only for the built-in
  list where coverage is known, honesty rule).
- Empty template (new event): canvas shows an explicit empty state with "Add your first
  element" guidance — not a fabricated default layout.

## 5. Save model & dirty guard (P3.1; board 4c verbatim)

- **Four states** (exact 4c copy adapted to i18n): `Saved · HH:MM` (success), `Saving…`
  (muted), `Unsaved changes` (warning — arms the guard), `Conflict` (destructive).
- Save = scoped `PUT` (§3.1) carrying the loaded `version`; success updates the pill and
  **unconditionally invalidates `READINESS_KEY(eventId)`** (§2) + the badge-template query.
- **Conflict (409)** blocks saving and shows a banner with two actions (user decision):
  "Reload server version" (discards local edits — tier-1 confirm) and "Overwrite" (re-PUT with
  the server's `current_version` — tier-1 confirm with explicit consequence copy). No
  version-diff UI in v1.
- **Dirty guard** on three paths (parent spec): in-app navigation (TanStack Router blocker),
  tab close (`beforeunload`), and Escape. Guard dialog per 4c: "Discard changes / Keep editing /
  Save & leave"; "Save & leave" that hits a Conflict keeps the user in the editor with the
  banner (never navigates away over an unresolved conflict).
- Editor-local race hygiene: version is the concurrency token (no `editVersionRef` needed —
  the server version IS the guard); in-flight save blocks a second save and the guard dialog's
  actions (exhaustive busy-gating rule).

## 6. Preview data (P3.1; user decision)

Canvas bindings resolve against a real attendee: default = first attendee of the event
(existing paginated endpoint), with a sample-attendee switcher (adopted from 4b's exploration —
search/pick any attendee to preview long names and real custom fields). Zero-attendee events
fall back to a clearly-labeled RU sample persona (marked as an образец in the UI — the one
sanctioned "fabricated" preview datum, it never leaves the canvas). Custom-field tokens missing
on the previewed attendee render as the empty string on canvas plus a subtle per-element hint —
never invented values.

## 7. P3.2 — Print truth

### 7.1 ZPL preview (board 4d — "the truth" render)

Modal from the top bar: tabs **Rendered** / **ZPL code**.

- **ZPL code** tab: the exact output of the existing generator for the previewed attendee
  (`POST /api/events/{id}/badge-zpl`), mono, copyable.
- **Rendered** tab: a raster preview produced LOCALLY by the backend reusing the same
  truetype-raster path that feeds the printer (new endpoint, e.g.
  `POST /api/events/{id}/badge-preview` → PNG; exact shape at plan time). Feasibility of
  raster→PNG from the `zpl` package is a plan-time verification; **fallback if it proves
  expensive:** v1 ships the ZPL tab plus the canvas render explicitly labeled "approximation —
  print a test badge for the truth" (honesty over fidelity), and the preview endpoint moves to
  the backlog.

### 7.2 Printer fonts & test print (via agent)

- Printer selector fed by the print agent (`agent/` service; its actual API — printer list,
  font list, print submission — is read off `agent/openapi.yaml` at plan time; the spec commits
  to intent, the plan to verified endpoints).
- "Fonts on this printer" list with Cyrillic-coverage badges; "Upload .ttf" reuses the existing
  event-font upload (`handler/fonts.go`) — no new font storage.
- **Test print:** one badge for the previewed attendee through the agent, with the agent's
  accept/fail surfaced honestly (submitted ≠ printed; show what the agent reports, nothing
  more).
- Panel↔agent connectivity model (how the SPA reaches the local agent: direct localhost call vs
  backend relay) is a plan-time verification against how `web/` does it today (`agentApi` in
  `PrintBadgeDialog.tsx`).

### 7.3 Print unlocks (P2-deferred, user decision: ships here, not P4)

- Attendee drawer "Reprint badge" goes live: generate ZPL for that attendee → agent print;
  per-attendee pending state; result surfaced (the P2.1 abort-ref/session-ref pattern for
  cancel-during-pending).
- Bulk bar "Print badges" goes live: sequential agent submissions over the page-scoped
  selection with progress and attempt-vs-success accounting (P2.2 print-all pattern); failures
  listed, never counted as done.
- Both stay DISABLED with an explanatory tooltip when no agent/printer is reachable — the
  locked idiom flips to a reachability-gated idiom, never a silent no-op.
- Zero-double-print guard (parent-spec success metric): per-attendee in-flight dedupe on the
  client; anything stronger (server-side print journal) is out of scope for v1.

## 8. Unlocks & readiness (P3.1)

- WorkspaceRail: `badge` step → live link (union: `overview | attendees | zones | staff |`
  `badge | settings`); Overview "What's next" badge row gets its real CTA (equipment stays
  locked until P4).
- Template save invalidates `READINESS_KEY` (§5); the readiness `badge` step flips on the
  backend's existing template check — no readiness backend changes.

## 9. Testing

- Contract tests for §3.1 (GET both shapes, PUT 200/400/409 incl. version bump and parser
  rejection); coverage ledger green.
- Panel: MSW tests per pane (elements CRUD reflected in template state, canvas selection sync,
  properties writes), the save-state machine (all four states + transitions, incl. 409 → banner
  → both resolutions), dirty-guard (router block, beforeunload registration, Escape), preview
  fallback (zero attendees → labeled sample), switcher.
- **Golden-ZPL backend tests (P3.2):** snapshot the generated ZPL for a fixed template ×
  {built-in font, uploaded font} × {RU, EN} sample attendees — CI-level regression proof for
  the preserved raster path, complementing (not replacing) the manual printed matrix (§1).
- keyParity EN/RU; established race patterns applied to every new mutation surface.
- Playwright e2e (badge-editor dirty guard) stays a P5 deliverable per the parent spec.

## 10. Out of scope

Undo/redo; multiple templates per event; template element types beyond what
`ParseBadgeTemplate` already supports (incl. images/logos if unsupported); collaborative
editing/presence; conflict version-diff UI; server-side print journal / double-print ledger;
in-product test-matrix UI (manual QA per §1); SSE/live anything (P4); e2e (P5).
