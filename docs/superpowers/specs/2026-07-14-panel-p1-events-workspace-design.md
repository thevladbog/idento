# P1 — Events & workspace spine (Home 1c, event CRUD, workspace 1f, Settings 6a, Organization) — Design

**Date:** 2026-07-14
**Parent spec:** [2026-07-13-panel-rewrite-design.md](2026-07-13-panel-rewrite-design.md) (§2 decisions "Home"/"Event workspace", §4 backend #6, §5 P1)
**Status:** approved by user 2026-07-14

## 1. Goal

Ship the panel's first real content: an operational Home (board **1c**),
event create/edit/delete, the event workspace with its readiness-pipeline
rail (board **1f**), Event Settings (board **6a**), and the Organization
settings screen — on top of the P0 foundation (@idento/ui kit, shell/auth,
typed openapi-fetch client, contract-tested openapi.yaml).

**Decomposition (user-approved): two sub-cycles, each its own plan → branch
→ PR**, mirroring how P0 was split:

- **P1.1 — Backend + Home + event create.** All three new endpoints (the
  readiness aggregate is needed by Home's upcoming-event cards, not just the
  workspace), data-layer additions (`openapi-react-query`, MSW), Home 1c,
  create-event flow.
- **P1.2 — Workspace + settings.** Workspace 1f layout + rail + Overview,
  Event Settings 6a (basics editing, fonts UI, API-keys UI, danger zone),
  Organization screen.

Scope decisions (user-approved): **Organization is included in P1** (it was
unassigned in the parent spec's phase list; its endpoints already exist).
Team stays a placeholder (P2), Equipment stays a placeholder (P4).

## 2. Backend — three new endpoints (P1.1)

All follow the P0.3 openapi-first workflow: document in `backend/openapi.yaml`
first → implement handler → Go contract test (`validateResponse` harness;
the coverage ledger fails CI for any documented-but-untested operation) →
`npm run generate:api -w panel`.

### 2.1 `GET /api/events/{id}/readiness` (parent-spec backend #6)

Response: `{ ready: boolean, steps: ReadinessStep[] }` where
`ReadinessStep = { key, status, count? }`,
`key ∈ {attendees, badge, zones, staff, equipment}`,
`status ∈ {done, not_done, skipped}`.

Semantics (all computed server-side):

| Step | done when | Blocks `ready`? |
|---|---|---|
| `attendees` | event has ≥ 1 non-deleted attendee (`count` = total) | **yes** |
| `badge` | a badge template exists for the event — the implementer derives the exact storage location from what `BadgeZPL`/the old editor actually reads (in `custom_fields`), not from assumption | **yes** |
| `zones` | zones exist for the event (`count`) → `done`; **no zones → `skipped`** | **no** — "zones excluded when skipped" per parent spec |
| `staff` | ≥ 1 staff assigned (`count`) | **yes** |
| `equipment` | never in P1 — always `not_done` until its P3/P4 wiring exists | **no** — otherwise check-in could never unlock before P4 |

`ready = attendees.done && badge.done && staff.done`. "Ready" is what
unlocks the check-in launch button in the 1f rail (P1.2) — the launch
target itself is P4; in P1 the unlocked button leads to a
placeholder/disabled action.

Protected (`bearerAuth` + 403), tenant-scoped via the same ownership helper
pattern as sibling event routes; 404/500 semantics must match whichever
helper is used (P0.3 documented three distinct masking patterns — follow
the actual helper's real behavior).

### 2.2 `PATCH /api/events/{id}` — scoped partial update

Parent spec mandates "scoped per-card saves — no full-PUT snapshots"; the
existing `PUT /api/events/{id}` is a documented full-replace (omitted field
= blanked). PATCH updates **only the fields present in the request body**:
`name`, `start_date`, `end_date`, `location`, `field_schema`.

**`custom_fields` is deliberately NOT patchable here**: it holds the badge
template; its scoped updates arrive in P3 with the badge editor's own save
model (parent spec P3: "scoped PATCH"). Excluding it makes it impossible
for a settings card to clobber the template.

### 2.3 `DELETE /api/events/{id}` — soft delete

Sets `deleted_at` (`models.Event.DeletedAt` already exists). Verify (and
fix if needed) that `GetEvents`/`GetEvent` exclude soft-deleted events —
this is part of the task, not an assumption. Success response: **204 No
Content** (this is a new handler, so the spec fixes the choice up front;
once implemented, the contract test pins it).

## 3. Data layer additions (P1.1)

- **`openapi-react-query`** (same openapi-ts ecosystem; zero codegen) wraps
  the existing `api` client from `panel/src/shared/api/http.ts` into typed
  `useQuery`/`useMutation` — this executes the decision recorded in the
  P0.3 spec's codegen table. The P0.2-era `ApiError` normalization and
  QueryCache/MutationCache global handlers keep working unchanged (the
  middleware sits below this layer).
- **MSW** (dev-dep) for screen/hook tests — parent spec §6 names
  vitest + Testing Library + MSW explicitly. URL-routed handlers replace
  the hand-rolled URL-switching fetch mocks (the pattern CodeRabbit
  flagged on PR #62 gets solved structurally). Existing tests are NOT
  mass-migrated — MSW is for new P1 tests; migration of old tests is
  opportunistic, not a goal.
- Feature hooks live in their feature slices (`src/features/<name>/`),
  shared query hooks in `src/shared/api/` — same layout rules as
  `panel/AGENTS.md` already defines.

## 4. Home 1c (P1.1) — `/`, replaces HomePlaceholder

- **Live-strip hero:** if a running event exists
  (`start_date ≤ now ≤ end_date`), show it with live counters from
  `GET /api/events/{event_id}/stats` polled via TanStack Query
  `refetchInterval` (~15 s; SSE upgrade is P4): checked-in big counter +
  progress bar, zone breakdown when `zone_stats` is present. The board's
  "Open monitor" / "Launch check-in station" CTAs are P4 surfaces — in P1
  the strip's CTA opens the event workspace instead ("stations online" /
  "scans/min" stats are likewise P4, no P1 data source). No running
  event → hero shows the next upcoming event with its readiness state and
  CTA into the workspace. No events at all → EmptyState teaching the
  create flow.
- **Upcoming / Past sections** as full-width row lists (board 1c shows
  table-like rows in one bordered container, not a card grid). Upcoming
  rows carry a compact readiness indicator — 5-segment bar + "N of M
  ready" fraction, exactly as board 1c draws it — with the per-step
  bullet detail (1e's checkmark lines, per the parent decision "bullets
  borrowed from 1e") shown in a tooltip on the readiness cell; the full
  bullet list's primary home is the workspace "what's next" panel (P1.2).
  Row action links are state-dependent, action-first copy per board 1c
  ("Continue setup →" / "Import attendees →"; past rows get "Report →").
  Past rows are visually dimmed and show the checked-in result stat.
- **Create event:** primary CTA opens a dialog (name required; dates,
  location optional) — zod validation with i18n'd messages (EN/RU), on
  success navigate to the new event's workspace route.
- Visual details (spacing, exact card composition, chip styles) are pulled
  from the Claude Design board (*Idento Panel.dc.html*, screens 1c) during
  plan-writing — the plan carries the specifics, not this spec.

## 5. Workspace 1f (P1.2) — `/events/$eventId`

- Layout route with the left rail as an **ordered readiness pipeline with
  chips**: Overview → Attendees → Badge → Zones → Staff → Equipment →
  Settings. Each step's chip renders its readiness status. Steps whose
  screens belong to later phases (Attendees P2, Badge P3, Zones P2, Staff
  P2, Equipment P4) are visible but locked — the rail teaches the pipeline
  (the point of 1f) — with an i18n'd "coming soon" affordance.
- **Launch ceremony pinned at the rail's bottom:** the check-in launch
  button, locked until `ready=true`. The actual launch flow is P4 — in P1
  the unlocked state leads to a placeholder.
- **Overview ("what's next"):** the first not-done required step surfaced
  as the primary action, plus event stats counters.
- Routes: index = Overview, `/events/$eventId/settings` = Settings 6a.
  Future-phase sections get no routes yet (locked rail items are not
  links).

## 6. Event Settings 6a + Organization (P1.2)

- **Settings** (`/events/$eventId/settings`): anchor-rail page of cards,
  each with its own scoped save:
  - *Basics* (name, dates, location) → `PATCH /api/events/{id}`.
  - *Fonts* → existing fonts endpoints (list/upload/delete; upload was
    fixed in PR #61/P0.3 and is contract-tested).
  - *API keys* → existing api-keys endpoints (list/create — show
    `plain_key` exactly once on create, per the contract — /revoke).
  - *Danger zone* → `DELETE /api/events/{id}` behind the two-tier
    typed-confirm `ConfirmDialog` from `@idento/ui` (type the event name).
    On success navigate Home.
- **Organization** (`/organization`, replaces placeholder): tenant settings
  form on existing `GET/PUT /api/tenants/{id}` — name, website,
  contact_email, logo_url. Note `PUT /api/tenants/{id}`'s real semantics
  were documented in P0.3 — the form must send the full editable set it
  read (it's a PUT), which is safe here because the form owns all editable
  fields on one screen.

## 7. Testing

- Go contract tests for the 3 new endpoints (mandatory — coverage ledger).
- vitest + Testing Library (+ MSW for new tests) for hooks and screens:
  Home states (running/upcoming/empty), readiness-bullet rendering,
  create-event validation + success navigation, rail chip states +
  locked-step behavior, launch-button lock, scoped-save cards (PATCH sends
  only its card's fields), danger-zone typed confirm, Organization form.
- EN/RU key parity enforced by the existing `keyParity.test.ts`.
- Each sub-cycle ends with a final whole-branch review (P0 pattern).

## 8. Out of scope (P1)

- Team/Staff screens (P2), attendees table/import (P2), zones management
  (P2), badge editor (P3), real check-in launch + station (P4), equipment
  hub (P4), SSE (P4), Home live-strip SSE upgrade (P4).
- Cookie-based auth migration (separate track), console (`/super-admin`).

## 9. Risks

- **Readiness "badge" check depends on where the template really lives** —
  mitigated by deriving it from the actual Go/old-editor code during
  implementation, with a contract test pinning the behavior.
- **PATCH/PUT coexistence confusion** — mitigated by documenting both ops'
  semantics in openapi.yaml prose and excluding `custom_fields` from PATCH.
- **Board fidelity** — 1c/1f/6a visual specifics come from the design
  board at plan-writing time; if the board's MCP is unavailable, the plan
  falls back to the parent spec's §2 decision descriptions.
