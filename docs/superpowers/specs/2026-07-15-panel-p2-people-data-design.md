# Panel P2 — People & data: attendees at scale, zones, staff

**Date:** 2026-07-15 · **Status:** approved
**Parent spec:** `docs/superpowers/specs/2026-07-13-panel-rewrite-design.md` (§5 P2, backend #1/#7)
**Board extract:** `.superpowers/sdd/p2-board-3e-6b-6c-extract.md` (screens 1g, 3a–3e, 6b, 6c, shared 1a/1b)
**Predecessors:** P0 (foundation, PRs #59/#60/#62), P1 (events & workspace spine, PRs #63/#64) — all merged.

## 1. Decomposition

Two sub-cycles, each its own plan → PR (mirrors P1.1/P1.2):

- **P2.1 “Attendees at scale”** — branch `panel/p2.1-attendees`. Backend additions (§3) + the
  attendees screen (§4) + attendee drawer 3e (§5) + CSV import wizard (§6).
- **P2.2 “Zones, staff & unlocks”** — branch `panel/p2.2-zones-staff`. Frontend-only: Zones 6b
  (§7), Staff 6c (§8), rail/Overview unlocks + Settings additions (§9).

Exit criterion for the phase (parent spec §8): a seeded 5,000-attendee dataset test passes —
implemented as a Go integration test in P2.1 (§3.4).

## 2. Constraints carried forward (locked in P0–P1, enforced in review)

- openapi-first for every new/changed endpoint: document in `backend/openapi.yaml` → handler →
  kin-openapi contract test (`validateResponse` + coverage ledger under `OPENAPI_COVERAGE=1`) →
  `npm run generate:api -w panel`, CI drift-checks committed `schema.d.ts`.
- Panel data hooks via `$api` only; MSW (`startMswServer`) for new tests; `getRouteApi` for typed
  params (never import route objects into components); `/register` `beforeLoad` and
  `protectedBeforeLoad` in `router.tsx` stay byte-for-byte untouched.
- Date-only semantics (`isDateOnly`, UTC-pinned display); i18n EN+RU with keyParity; no fabricated
  data in loading/error states; WCAG 1.4.1 (icon+text+color); `@idento/ui` primitives only,
  token classes only.
- Mutation hygiene: session-id refs for cancel-during-pending races (P1.2 pattern in
  `ApiKeysCard`/`DangerZoneCard`), mutation reset on dialog close, typed-confirm dialogs stay open
  on failure, edit-version guard against stale-response overwrite (P1.2 `GeneralCard` pattern).
- QR/barcode rendering is always local — never a third-party API (board 3d architectural note).

## 3. Backend additions (all in P2.1)

### 3.1 `GET /api/events/{event_id}/attendees` — server-side pagination & filters

New optional query params: `page` (1-based), `per_page` (1–200), `zone` (zone uuid — attendees
with an attendee-zone-access row for that zone), `status` (`checked_in` | `not_checked_in`).
`search` (substring across name/email/code) and `code` (exact) already exist and combine with the
new filters.

**Back-compat contract:** when `page` or `per_page` is present, the response is an envelope
`{ attendees: Attendee[], total: int, page: int, per_page: int }` (`total` = count after filters,
before paging). When neither is present the response stays the legacy bare `Attendee[]` — the
mobile clients that consume this route today are untouched. Contract tests cover both shapes.

### 3.2 `POST /api/events/{event_id}/attendees/bulk` — per-row errors

`BulkImportResponse` gains `errors: [{ row: int, data: string, problem: string }]` — `row` is the
1-based index within the submitted `attendees` array, `data` a short human identifier for the row
(name or email, may be empty), `problem` a stable machine-readable-ish description (duplicate
email/code against the existing list, per-row create failure). Existing fields
(`created`/`skipped`/`total`/`duplicates`) are unchanged; rows that fail no longer disappear into
a bare `skipped` count. Valid rows continue to commit — the import is never all-or-nothing.

### 3.3 `DELETE /api/events/{event_id}/staff/{user_id}` — unassign staff

New handler over the existing (currently unused) store method `RemoveStaffFromEvent`. Fixes a
live production bug: `web/`’s `EventStaff.tsx` already calls this route and 404s. 204 on success;
same ownership-masking 404 conventions as sibling event routes.

### 3.4 Seeded 5k test

Go integration test: seed 5,000 attendees on one event, assert paginated responses (page
boundaries, `total`, zone/status/search filter correctness) — the phase’s scale exit criterion.

**Explicitly no other backend work.** Zone access rules already exist end-to-end (CRUD +
`evaluateZoneAccessRules` applied lazily at scan time via `CheckZoneAccessAt`) — the parent
spec’s “re-evaluated on import” holds by construction, because rules are evaluated per scan, not
materialized. `field_schema` is already updatable via `PATCH /api/events/{id}` (pointer-partial).

## 4. Attendees screen (P2.1; board 1g content region)

Route `/events/$eventId/attendees` — third child of the workspace layout. Reconciliation: board
1g demonstrates the losing top-tabs nav shell; only its **content region** is adopted — the 1f
left rail (shipped in P1.2) remains the navigation.

- **Header row:** `h2` + plain mono total (from the envelope), 230px search box (debounced →
  server `search`), “Zone: All” and “Status: Any” dropdown filters, right-aligned “Import CSV”
  (outline) + “+ Add attendee” (primary).
- **Table** (dense): checkbox / Name (bold + mono code second line) / Company / Zone access
  (plain names joined “·”) / Badge StatusPill (Printed → success, Not printed → muted) / Status
  (plain text; Checked in state styled from the StatusPill success vocabulary) / `⋯` row menu.
  Selected rows get the subtle success-tint background. Row click opens the drawer (§5).
- **Pagination footer:** “1–50 of N” + numbered pager with ellipsis (server-side, 50/page).
- **Bulk bar** (dark, inline above the table when ≥1 row selected): “N selected” · Assign zone
  (creates attendee-zone-access for the selection) · Export (existing endpoint) · Delete…
  (typed-confirmation tier per board 1b) · Clear. “Print badges” from the board renders as a
  locked “coming with the badge editor” chip until P3 — the honest-locked pattern from P1.2.
  Bulk delete executes sequential `DELETE /api/attendees/{id}` over the selection (selection is
  page-scoped, max 50) with progress; no bulk-delete endpoint is added.
- **Add attendee:** dialog (first/last name, email, company, position; code optional — server
  generates) mirroring `CreateEventDialog` patterns.
- **Empty state:** the canonical 1b “No attendees yet” EmptyState verbatim (Import CSV primary +
  Add manually secondary).

## 5. Attendee drawer (P2.1; board 3e — the winner; 3d full page is explicitly out of scope)

Opens over the table; selected attendee id lives in a **typed search param** (`?attendee=`), so
refresh/deep-link restores the open drawer. `Sheet` from `@idento/ui`, 400px, right side.

Sections top-to-bottom: initials avatar + name + `Company · code` + close; status pill
(“Checked in · HH:MM · location” success pill, or muted “Not checked in”); action row —
“Edit details” (in-drawer form → `PUT /api/attendees/{id}`) and “Reprint badge” **locked until
P3**; **Zone access** — success chips per zone + dashed “+ Zone” picker
(create/delete attendee-zone-access); **Recent activity** — up to 3 entries from the
zone-history endpoint, format “HH:MM — event · device” (no “Full timeline →” link in v1 — the
target page 3d isn’t built); footer — “Regenerate code…” and “Delete…” as destructive links,
both **tier-1** destructive confirms (the typed tier is reserved for bulk delete and event-wide
destructive ops per 1b).

## 6. CSV import wizard (P2.1; boards 3a/3b/3c — modal, 3 steps)

PapaParse (new panel dependency) parsing in a **Web Worker** (`worker: true` in production;
plain parse in jsdom tests — flag differs by environment, documented in code).

- **Step 1 — File & encoding:** read as ArrayBuffer; try `TextDecoder("utf-8", { fatal: true })`,
  on failure (or U+FFFD replacement density) fall back to `windows-1251`. “Auto-detected” info
  badge + two-way segmented override (Windows-1251 / UTF-8 only — not a full charset dropdown).
  Live preview of the first 3 decoded rows re-renders on override; mojibake hint caption.
- **Step 2 — Column mapping:** grid `CSV column → Idento field | sample values`. Targets:
  standard fields (first/last name, email, company, position, code), a custom field named after
  the column, or “Don’t import”. An unmapped column is amber and must be acknowledged (pick a
  field or confirm skip) before continuing. The event’s `field_schema` is derived from the
  mapping and sent with the bulk request. In-file duplicates (same email) are merged client-side
  keep-first, with the merged count shown in the footer caption. CTA shows the live row count.
- **Zone reconciliation (design decision):** zone access is **not materialized at import**. A
  category-like column maps to a custom field; dynamic access comes from zone rules (§7)
  evaluated at scan time. (The bulk response returns no created ids, so materialization is
  impossible without new backend — rules solve it strictly better.) The board’s “Map zone”
  error-row type therefore does not exist in v1.
- **Step 3 — Progress & per-row errors:** chunked POSTs to `/bulk` (500 rows/chunk) driving a
  real progress bar; header count “X of N imported”; amber banner “N rows need attention — valid
  rows are already in the list”. Error table (Row / Data / Problem / action): “Fix inline” for
  invalid emails (editable cell, re-submits the single row), “Keep first”-style dismiss for
  duplicates, “Skip row” for unfixable rows. “Download N rows as CSV” exports the failing rows.
  Step 3 has no close ✕ while an import is in flight. Done CTA: “Done — N in the list”.

## 7. Zones (P2.2; board 6b)

Route `/events/$eventId/zones`. Header: `h2 Zones` + mono count + caption “Optional — attendees
always get the entrance zone.” + “+ New zone”.

- **Zone list card:** per-zone row — color swatch, name (+ “Entrance zone” subtitle where
  applicable), access-type text (“All attendees” / “By rule” / “Manual list only”), people count
  **only if the zone schema exposes one** (plan-time verification; if absent, omitted — never
  fabricated), `⋯` menu.
- **“+ New zone”:** dialog — name + color from a small fixed palette (zone create endpoint
  exists; exact model fields verified at plan time).
- **Inline rule builder** (expanded row, success-tinted with 3px left accent): sentence UI —
  “Access when [Category ▾] is [value ▾] + or condition”. Exactly what the board shows: one
  field (Category), one operator (is), OR-only clause list. Saves via
  `bulkUpdateZoneAccessRules`. Live match count only if cheaply computable; otherwise omitted.
- **Zone delete:** always the typed-confirmation tier (simpler and safer than detecting
  check-in history).
- **Manual-list zones:** membership is managed from the attendee drawer’s zone chips (§5), not
  from this screen (the board depicts no manual-list management UI).

## 8. Staff (P2.2; board 6c)

Route `/events/$eventId/staff`. Header: `h2 Staff` + mono count + caption “Event-day access via
QR login — no accounts, no passwords, minimal training.” + “Print all QR cards” (outline) +
“+ Add staff” (primary).

- **Card grid** (3 per row): initials avatar, name, station subtitle, “Signed in / Not yet”
  status dot **only if a data source exists** (plan-time verification; omit if none — honesty
  rule), QR visual **rendered locally**, caption “QR login · zones: …” from the user’s zone
  assignments + “expires when event ends”. Actions: “Print card” (browser print), “Zones”
  (zone-scope editor over `zones/{zone_id}/staff` endpoints), “Revoke…” (tier-1 confirm, board 1b
  copy: “His QR login for this event stops working. You can re-add him anytime.” → the new
  DELETE staff endpoint).
- **Lost-card state:** warning-tinted box + “Regenerate QR…” (existing `generateQRToken`,
  tier-1 confirm — a new token invalidates the lost card).
- **“+ Add staff”:** dialog — pick an existing tenant user (`getUsers`) or create one
  (`createUser`, admin-only), then `assignStaffToEvent`.
- **“Print all QR cards”:** print-stylesheet page rendering every staff card for one print job.
- Footer note: “Admins & managers sign in with their own accounts — manage them in Team” (staff
  QR logins are event-scoped and separate from org accounts).

## 9. Unlocks & Settings additions (P2.2)

- **WorkspaceRail:** attendees/zones/staff step rows become real links with active states
  (the `active` union grows to `overview | attendees | zones | staff | settings`); badge and
  equipment stay locked.
- **Overview “What’s next”:** attendees/staff rows get real CTAs; badge/equipment keep the
  locked chip.
- **Danger zone honesty fix:** the existing generate-codes endpoint only **backfills missing
  codes** (non-destructive). The Settings row ships as “Generate missing codes” (plain action,
  no typed confirm needed); a true “regenerate all codes” is deferred until backend support is
  actually wanted (YAGNI).
- **Attendee fields** Settings card: list `field_schema` entries; add / rename / remove →
  `PATCH /api/events/{id}` with the new array. Copy states removal never deletes stored values
  from attendees’ `custom_fields`.

## 10. Testing

- Contract tests for §3.1 (both response shapes), §3.2, §3.3; coverage ledger stays green.
- Seeded 5k Go test (§3.4).
- Panel: MSW component tests per screen and per wizard step; the win-1251 path tested with real
  windows-1251 bytes; keyParity EN/RU; the established race-condition regression patterns
  (session-id refs, edit-version guards) applied to every new mutation dialog.
- Playwright e2e (CSV import happy path) stays a P5 deliverable per the parent spec — not built
  here.

## 11. Out of scope

Attendee full page 3d (drawer only in v1); AND/multi-field/multi-operator zone rules (board
shows Category-is-value OR-only); zone capacity limits; staff roles/permissions beyond zone
scope; bulk “Print badges” (P3); real regenerate-all-codes backend; SSE/live counters (P4);
import e2e (P5).
