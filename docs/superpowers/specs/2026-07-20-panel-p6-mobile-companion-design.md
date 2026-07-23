# Panel P6: Mobile Companion — Design

**Date:** 2026-07-20
**Status:** approved — design boards generated and reviewed 2026-07-22 (`Idento Panel Mobile.dc.html`, board t8 / frames 8a–8t, in the "Idento event check-in landing" Claude Design project); open questions resolved (see §9). Ready for the P6.1 plan cycle. Phase number P6 stays provisional; P5.2/P5.3 remain next in the cutover track and are unaffected.
**Inputs:** panel functional map (`panel/src/app/router.tsx`, feature slices), [customer-web-panel.md](../../design-briefs/customer-web-panel.md) (responsive stance §4), [2026-07-13-panel-rewrite-design.md](2026-07-13-panel-rewrite-design.md) (decisions log: "tablet targets check-in + monitoring only"), mobile KMP app scope (`mobile/shared`), `backend/openapi.yaml`, logo handoff (`docs/design-briefs/design_handoff_idento_logo/`).
**Companion brief:** [customer-web-panel-mobile.md](../../design-briefs/customer-web-panel-mobile.md) — the design-generation brief for this initiative.

## 1. Context & Problem

The panel (`panel/`) is desktop-first by an explicit product decision: prep happens at a desk, the phone gets only a nav drawer, and the tablet targets check-in + monitoring. That stance was right for the rewrite — but it leaves the organizer's highest-mobility moments unserved. On event day the organizer is *walking the venue*, not sitting at a desk: they want live numbers, a dead-station alert, "is Ivanov checked in?", "give this new staffer a login", "spin up one more registration station". Today, on a phone, the panel collapses to a hamburger with four org links; every workspace page overflows horizontally (fixed `w-[236px]` rail, fixed-column tables, hard-coded monitor grid).

The full panel cannot and should not fit a phone. The badge editor, CSV import, zone-rule builder, and equipment hub are desktop tools — some physically cannot work on a phone (Equipment talks to a local agent on `localhost:12345`). The initiative is therefore a **curated mobile companion surface inside the same app**: everything an organizer needs *away from the desk*, first-class on a phone; everything else honestly gated to desktop.

The existing KMP mobile app is **not** this surface and stays untouched: it is a station-bound scanner (registration desk / zone control / kiosk) that deliberately owns operational scanning and offline check-in. The mobile panel is the *management* counterpart. Their one touchpoint — station provisioning — becomes a deliberate cross-product flow (mint the provisioning QR on the organizer's phone, scan it with the station device).

## 2. Approach Decision

Three approaches considered:

- **A. Adaptive layouts in the existing `panel/` SPA (chosen).** Same routes, same auth, same generated API client; per-page mobile layouts below `md`, component-level swaps where a desktop pattern cannot reflow, and a `DesktopOnlyGate` for excluded surfaces. Zero backend work, zero new deployment topology (P5.1's combined image already serves the panel at `/`), URL parity means any shared link works on any device.
- **B. Separate mobile PWA workspace (rejected).** A second app duplicates auth, shell, i18n, API client, and drifts from the panel; contradicts "мобильная версия веб-панели"; doubles maintenance for a companion surface.
- **C. Extend the KMP app with admin features (rejected).** Breaks the app's deliberate station-lockdown model (provisioned devices swap to a station-scoped `staffJwt` — no manager session to build admin UI on), mixes personas, and puts admin releases behind app-store cycles.

**Consequence of A:** all v1 functionality must come from endpoints the panel already consumes — and it does (see §5.4). No OpenAPI change, hence no `generate:api` churn beyond normal.

## 3. Personas & Jobs on the Phone

- **Organizer / admin, on the venue floor (primary).** Live check-in pulse; per-zone and per-station numbers; station liveness ("kiosk 3 went dark"); attendee lookup → verdict-grade answer + exceptional actions (undo, block, manual check-in); staff QR login handout; mint a provisioning QR.
- **Organizer, pre-event, away from desk (secondary).** Readiness pipeline glance ("what's still not done"), attendee count growth, event dates/status; light triage, no authoring.
- **Manager across events / orgs (secondary).** Home list with the live strip; org switcher; jump into any event's overview/monitor.
- **Explicitly not a persona here:** field staff scanning attendees — that is the KMP app and desktop station.

## 4. Scope Tiers (the core analysis)

**Tier 1 — first-class mobile (dedicated phone layouts, no usability compromises):**

| Surface | Mobile shape | Why it fits |
|---|---|---|
| Auth: `/login`, `/qr-login` | Existing `max-w-sm` forms, touch polish only | Already phone-shaped |
| Home `/` + LiveStrip | Stacked cards: running-event pulse hero → upcoming → past; New-event dialog kept | Read/act list; live strip is the #1 glance |
| Event overview (workspace index) | Readiness card + 2-col stat tiles (already `grid-cols-2 md:grid-cols-4`) | Read-only; the pre-event glance |
| Live monitor `/events/$id/monitor` | Single-column stack: totals (rate, peak, ETA) → zones → stations w/ liveness → recent feed | Read-only SSE dashboard; the on-floor glance |
| Attendee quick lookup | Search-first list replaces the 7-col table below `md`; attendee card = status, zones, actions (manual check-in, undo, block/unblock, show QR) | The #1 on-floor question; actions are single-tap, not bulk |
| Staff | Card list; assign/unassign team members; per-zone assignment picker; **QR login token full-screen on the phone** (staffer scans it off the organizer's screen) | Phone-native flow, better than the desktop print path |
| Station provisioning | "Add station" → full-screen provisioning QR (TTL countdown) → station device scans it | Cross-product killer flow; endpoint already exists |
| Shell chrome | Org switcher, theme, language, impersonation banner, suspended-tenant screen | Parity is mandatory for trust |
| Staff self-service (`staff` role) | Own status page: assignment, zones, "Show my login QR" via QrDisplay — nothing else | Resolves open Q6 (board 8q); the KMP app stays their working surface |

**Tier 2 — usable-but-basic (simple reflow, no dedicated design):** Organization page (single form), event create dialog, event general info (read-only view on phone), error/empty/loading states.

**Tier 3 — desktop-only behind a graceful gate:** badge editor, CSV import wizard, Equipment hub (localhost agent is unreachable from a phone by nature), zone rule builder, full Event Settings (fonts, API keys, attendee fields, danger zone), check-in Launch ceremony + Station page (operational scanning belongs to the KMP app / desktop station), Team page (stub today). The gate is a first-class screen: explains *why*, shows what the page does, offers "copy link for desktop".

**Tier assignment rationale, in priority order:** (1) hardware coupling (agent on `localhost:12345` — physically impossible), (2) interaction class (drag/canvas/multi-pane/bulk — unacceptable compromises on touch), (3) overlap with the KMP scanner (don't rebuild scanning), (4) value-on-the-go (authoring is a desk activity by the rewrite's own two-tempos model).

## 5. Architecture

### 5.1 Adaptive mechanisms (three, in order of preference)
1. **CSS reflow (Tailwind v4 breakpoints)** where the desktop layout can stack: Home, overview, monitor, staff, org page. The monitor's hard-coded `gridTemplateColumns: "1.15fr 1fr"` becomes a responsive grid.
2. **Component-level swap** where the desktop pattern cannot reflow: `AttendeesPage` renders `AttendeeTable` ≥ `md` and a new `AttendeeSearchList` below (shared hooks/query state; one route, two presentations). One `useIsMobile()` (matchMedia, SSR-safe) sanctioned in `shared/`; CSS-only preferred whenever markup can be shared.
3. **`DesktopOnlyGate`** (new `@idento/ui` or panel-shared component) wrapping Tier-3 routes below `md`.

No `/m/*` route subtree, no user-agent sniffing, no separate bundle. Breakpoint cutover stays `md` (768px); phone design reference is 390px (matches board 7f).

### 5.2 Navigation
- Org level: existing hamburger → `NavDrawer` (Sheet) — kept.
- **Event workspace on phone: bottom tab bar** replacing the hidden 236px rail — Overview / Monitor / Attendees / Staff / More (More = sheet listing Tier-3 items with gate affordances + event settings info). Thumb-reach beats a drawer for the on-floor loop (overview ↔ monitor ↔ lookup). Readiness chips from the rail surface as a compact pipeline strip on Overview instead. Alternative (horizontal scrollable pill row) documented in the brief's open questions.
- Safe-area: tab bar and full-screen QR views respect `env(safe-area-inset-*)`.

### 5.3 PWA-lite
Web app manifest + icon set from the logo handoff (`app-icon-*.svg` exist; synergy with the pending logo-refresh wiring — do the favicon/manifest work once, together). Installable to home screen. **No service worker / offline in v1** — every Tier-1 surface is live data; offline belongs to the KMP app. `theme-color` already present.

### 5.4 Data / API — zero backend changes
All Tier-1 needs are served by endpoints the panel already consumes: `GET /api/events/{id}/stats`, `GET /api/events/{id}/monitor` + `/monitor/stream` (SSE, thin-ping + snapshot invalidation, reconnect/backoff already built), `GET /api/events/{id}/readiness`, attendees search + `/block` + `/unblock`, `POST /api/events/{id}/checkin` + `/undo`, event staff assign/unassign + zone staff, `POST /api/users/{id}/qr-token`, `POST /api/events/{id}/stations/provisioning-token`. Role gating follows the existing per-tenant pattern (role from `GET /api/tenants/{id}`, not cached `user.role`).

### 5.5 Design-system deltas (`@idento/ui`)
Confirmed by boards 8r/8s: `TabBar` (bottom nav; active state derived from the router, ≤5 items, safe-area padding, warning-dot badge — no counts), `ListRow` (leading/content/trailing slots, 56px comfortable / 48px compact, inset divider), `QrDisplay` (white canvas in both themes, wall-clock TTL with an explicit expired state; brightness is a user-facing hint — no browser API exists for it), `DesktopOnlyGate` (three flavors: canvas-tool / agent-bound / bulk-data; render swap on the same URL, never a redirect). Touch-target audit: interactive primitives ≥ 44×44 px on touch (`pointer:coarse`), without inflating desktop density.

## 6. Implementation Roadmap (phases; each runs the house spec → plan → PR cycle)

Design boards are generated first from the companion brief (same pipeline as `Idento Panel.dc.html`), then each phase gets its dated spec + plan. Provisional cost is S/M/L relative to recent panel phases.

- **P6.1 Foundations & shell (M).** Adaptive conventions codified in `panel/AGENTS.md` (no fixed-px structural widths below `md`; `useIsMobile` rules; safe-area). Bottom `TabBar` + workspace nav swap; `DesktopOnlyGate` primitive + applied to all Tier-3 routes (the app becomes *honest* on phones in the first PR); PWA manifest + icons (joint with logo-refresh wiring); Home + overview reflow. Acceptance: no horizontal overflow anywhere at 390px; every route either usable or gated; Lighthouse installability passes.
- **P6.2 Live ops (M).** Monitor phone layout (stacked, glanceable typography per board), LiveStrip phone polish, SSE reconnect states legible on mobile (venue Wi-Fi). Acceptance: monitor fully readable at 390px light+dark; stream badge states verified with throttled network.
- **P6.3 People & quick actions (L).** `AttendeeSearchList` + attendee card with exceptional actions (manual check-in with "no badge printed" notice, undo, block/unblock, QR); staff mobile cards + full-screen QR login handout; "Add station" provisioning QR mint. Acceptance: lookup → verdict in ≤ 2 taps from monitor; all actions role-gated as on desktop; QR flows verified against the KMP app end-to-end.
- **P6.4 Hardening & parity (M).** Tier-2 reflow sweep; e2e at mobile viewport (Playwright 390×844 profile) for the Tier-1 loop; touch a11y pass (44px, focus, `aria-live` on live counters); perf budget on mid-range mobile; i18n key parity (en/ru) for all new copy; docs + ledger updates. Acceptance: green e2e mobile suite in CI; AA contrast both themes.

## 7. Testing

- Unit/component: Vitest + Testing Library with viewport-mocked `matchMedia` for `useIsMobile`; MSW as today.
- E2E: mobile-viewport Playwright project running the Tier-1 loop (login → home → overview → monitor → lookup → action → staff QR → provisioning mint).
- Contract: none new (no OpenAPI change) — drift check unaffected.
- Manual gates: real-device pass (iOS Safari + Android Chrome) for safe-area, QR brightness/scanability from the KMP app, SSE behavior on cellular.

## 8. Risks & Mitigations

- **Scope creep toward "full panel on phone".** The tier table is the contract; anything moving tiers needs a spec amendment.
- **Two presentations drift (table vs search list).** Shared hooks/query state mandatory; presentation-only splits; covered by shared tests.
- **Manual check-in on phone bypasses badge printing.** Explicit "checked in — no badge printed" notice + reprint remains a station/desktop affordance. (Open question #2.)
- **Bottom tab bar novelty in this codebase.** Prototype in P6.1 behind the `md` breakpoint only; desktop untouched by construction.
- **SSE on venue cellular/Wi-Fi.** Reuse existing backoff; mobile layouts must show staleness honestly (existing "Updated Ns ago" pattern).

## 9. Decisions Log & Open Questions

Decided (design review, 2026-07-22): approach A (adaptive same-app); scanning stays out of mobile web; no offline/push in v1; `md` cutover kept; **bottom tab bar confirmed** (board 8a); **attendee card is a state-dependent hybrid** — not-checked-in renders board 8i (primary "Check in manually" with the structural no-badge notice), checked-in renders board 8h (grouped action list, destructive isolated at the bottom); manual check-in stays on phone with the notice + undo toast; event info is read-only on phone; PWA manifest + icons ship in v1, no service worker; **staff self-service page ships** (board 8q); **staff sign-in liveness is dropped from v1** — it is not in the API contract, so staff cards show role/zones/assignment only, and liveness returns as its own later increment when the backend exposes it (this preserves zero backend changes); phases numbered P6.x pending blessing.

Implementation notes from the design review: board 8l's footnote says `GET /users/{id}/qr-token` — the real endpoint is `POST /api/users/{id}/qr-token`; TTL figures on the boards (4:58 / 9:32) are illustrative — bind countdowns to the actual token TTLs returned by the backend; the suspended screen's "Open billing" CTA is SaaS-only (edition-aware copy via `useInstance`). All resolved answers are mirrored in the companion brief §11.
