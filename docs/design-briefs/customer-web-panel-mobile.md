# Design Brief: Idento Panel — Mobile Companion (Adaptive Phone Surface)

**Date:** 2026-07-20
**Scope:** the phone-adaptive layer of the customer panel (`panel/`) — a curated subset of the existing app made first-class on ~390px screens, inside the same SPA, same routes, same auth. Not a separate app; not the KMP station app. Anticipated by [customer-web-panel.md](customer-web-panel.md) §4 ("Responsive stance") and extends it: the drawer-and-tablet stance grows a real phone surface for on-the-go management.
**Inputs:** panel functional map (`../../panel/src/app/router.tsx`, feature slices), master spec [2026-07-20-panel-p6-mobile-companion-design.md](../superpowers/specs/2026-07-20-panel-p6-mobile-companion-design.md), monitor board 7e + drawer board 7f in [Idento Panel.dc.html](idento-event-check-in-landing/project/), KMP app scope (`../../mobile/shared`), logo handoff ([design_handoff_idento_logo/README.md](design_handoff_idento_logo/README.md)), `backend/openapi.yaml`.

## 1. Project Overview

**Product:** the organizer's pocket command center. The Idento panel runs the full event lifecycle on desktop; this brief designs the subset that must work *away from the desk* — glanceable live monitoring, people lookup with exceptional actions, staff login handout, and station provisioning — as adaptive phone layouts of the existing pages. Everything else stays desktop and must *say so gracefully*.

**The one-sentence pitch:** on event day the organizer walks the venue with the panel in their pocket — live pulse, dead-station alerts, "is Ivanov checked in?", "here's your login QR", "spin up another station" — without ever wishing they'd brought the laptop for those jobs.

**Relationship to sibling surfaces:** the KMP mobile app remains the dedicated station scanner (registration / zone control / kiosk) — this surface never scans attendees. The desktop panel remains the authoring tool (badge editor, CSV import, zone rules, equipment, settings). The tablet monitor (board 7e) already exists; the phone monitor is its vertical sibling.

## 2. Users & Context of Use

- **Organizer/admin on the venue floor (primary).** Standing, walking, one hand, bright and noisy environment, venue Wi-Fi or cellular. Checks numbers between conversations; acts in bursts of seconds. Interruptions are constant — every screen must survive being glanced at for two seconds and abandoned mid-flow.
- **Organizer pre-event, out of office (secondary).** Commute / between meetings: "what's still not ready?", "how many registered overnight?" Read-mostly, calm.
- **Manager across events/orgs (secondary).** Home list, org switcher, dive into any event's overview or monitor.
- **Roles:** `admin` and `manager` see management actions; `staff` on a phone browser sees only what they see on desktop today (their surfaces live in the KMP app). Role comes per-tenant (`GET /api/tenants/{id}`), same gating as desktop.
- **Not served here:** scanning attendees, badge printing, any desk-tempo authoring.

## 3. Core Objects & Information Architecture

Objects unchanged (Event, Attendee, Zone, Team member/Staff, Station). The mobile IA is a **tiered cut** of the desktop IA:

- **Tier 1 — first-class phone surfaces:** Login + QR login; Home (LiveStrip hero + event lists); Event overview (readiness + stats); Live monitor; Attendee quick lookup (search-first list + attendee card with actions); Staff (cards, assign, full-screen QR login token); Station provisioning ("Add station" → full-screen QR); shell chrome (org switcher, theme, language, impersonation banner, suspended screen).
- **Tier 2 — usable-but-basic (reflow only, no dedicated design):** Organization page, New-event dialog, event general info (read-only), all empty/error/loading states.
- **Tier 3 — desktop-only, gated:** badge editor, CSV import, Equipment hub (needs the local agent on `localhost:12345` — physically unreachable from a phone), zone rule builder, full Event Settings, check-in Launch + Station, Team page.

**Phone navigation model:**
- Org level: existing hamburger → drawer (board 7f) — unchanged.
- **Event workspace: bottom tab bar** (recommended; see Open Questions) — Overview / Monitor / Attendees / Staff / More. "More" opens a sheet listing Tier-3 sections with their gate states plus event info. The desktop rail's readiness chips become a compact pipeline strip on Overview.
- Same URLs everywhere. A deep link to a Tier-3 page on a phone lands on its gate screen, never a broken layout.

## 4. Key Design Problems to Solve

- **Glanceability under motion.** The monitor and LiveStrip must read at arm's length while walking: one number per card at XXL, rate/peak/ETA as secondary, per-zone and per-station as scannable rows. Reuse board 7e's hierarchy, restacked for portrait 390px.
- **One-hand reach.** Primary loop (overview ↔ monitor ↔ lookup) lives in the bottom tab bar; destructive/rare actions stay out of thumb's accidental reach. All touch targets ≥ 44×44px without inflating desktop density (`pointer: coarse` scoped).
- **Table → search-first list.** The attendees table (7 fixed columns, bulk bar, 400px drawer) cannot reflow. Design its phone sibling as search-first: prominent search field, result rows (name, company, status pill), full-screen attendee card. No bulk operations, no import, no column editing on phone — by design, not omission.
- **Exceptional actions with ceremony, not friction.** Attendee card actions — manual check-in (with explicit "no badge printed" notice), undo check-in, block/unblock — are one tap + one confirm, using the existing ConfirmDialog severity language. These are floor-emergency tools; they must be fast but never accidental.
- **QR as a first-class screen.** Two full-screen QR moments: staff login token (staffer scans the organizer's phone with the KMP app) and station provisioning token (station device scans it). Design: max-brightness-friendly white canvas, the QR at maximum size, who/what it's for, TTL countdown, regenerate action. This flow replaces desktop's "print the QR" ritual and should feel like the *better* way.
- **The honest gate.** Tier-3 pages on a phone get a real screen, not a dead end: what this section does, why it's desktop-only (one line — e.g. "the badge editor needs a large canvas and your printer's local agent"), and "copy link for desktop". It must feel like a considered product decision, not a wall.
- **Live-data honesty on venue networks.** SSE reconnect states (existing backoff + "Updated Ns ago") must be legible on mobile: a compact staleness badge pattern that never lets stale numbers masquerade as live.
- **Interruption-proof flows.** Every multi-step phone flow (assign staff, mint QR) survives backgrounding the browser; on return, state is either intact or safely restarted — never half-committed.

## 5. Deep-Dive: the Five Signature Phone Surfaces

1. **Home.** LiveStrip as hero card for the running event (checked-in/total, progress, per-zone chips) → Upcoming → Past as stacked rows. New-event stays a dialog (it's small). Empty states teach, as on desktop.
2. **Event overview.** Readiness pipeline strip (attendees → badge → zones → staff → equipment as compact chips; done/not-done/skipped) + "what's next" card + 2×2 stat tiles. This is the pre-event glance screen.
3. **Monitor (phone).** Vertical stack: TotalsCard (XXL checked-in/total, rate/min, peak, ETA) → ZonesCard rows → StationsCard rows with liveness dots (`last_seen_at` math exists) → RecentFeed (last 20). Chrome-less feel, staleness badge top-right. Portrait sibling of board 7e.
4. **Attendee lookup & card.** Search-first list; card shows identity, status (checked-in + timestamp / not / blocked), zone access, and the action row (check-in / undo / block / unblock / show attendee QR). Verdict semantics share the app-wide status language (same tokens as station verdicts).
5. **Staff & provisioning.** Staff cards (name, role, zones, status) with assign/unassign via bottom-sheet picker of team members and zone picker. Per-staffer "Show login QR" → full-screen QR. Separate "Add station" entry (from Staff's More or Overview quick action) → provisioning QR with TTL. Both QR screens share one `QrDisplay` pattern.

## 6. Visual Identity

- **Same brand, same tokens — no mobile fork.** All colors from `packages/ui/src/theme.css` variables (primary `#00935e`, success/warning/info families, light + dark). Phone layouts must work in both themes; check AA contrast outdoors-bright (light) and low-light (dark).
- **Logo:** use the new handoff ([design_handoff_idento_logo/README.md](design_handoff_idento_logo/README.md)) — mark simplification tiers by size apply directly (24–39px drops the lanyard slot; ≤20px filled tile); PWA icons come from `assets/app-icon-*.svg`. Never center the mark by bounding box — align by the badge rect.
- **Typography:** Inter Variable, existing type ramp (`text-page-title` … `text-code`); monitor numbers may use an XXL display size consistent with board 7e rather than a new ramp entry — if a new token is needed, add it to the ramp, don't inline it.
- **Status language:** the shared icon+text+color status/verdict vocabulary — never color alone, no emoji; `StatusPill` everywhere.
- **Density:** glance surfaces (monitor, LiveStrip) run large and airy; lists run comfortable (48–56px rows); nothing on phone uses desktop-compact table density.
- **Language:** full EN/RU parity via i18n keys, as enforced repo-wide.

## 7. Technical & UX Constraints

- Stack fixed: React 19 + TanStack Router (code-based routes — same routes, no `/m/*` subtree) + TanStack Query + generated OpenAPI client; Tailwind v4 CSS-first tokens; **`@idento/ui` primitives only — native form controls are ESLint-banned**; lucide icons; i18next.
- **Zero new backend endpoints.** Everything is served by the existing contract (`stats`, `monitor` + SSE stream, `readiness`, attendee search/block/unblock, checkin + undo, event/zone staff, `users/{id}/qr-token`, `stations/provisioning-token`). Designs must not assume data the contract doesn't return.
- Adaptive mechanics: Tailwind reflow first; one sanctioned `useIsMobile()` for component swaps (attendees table ↔ search list); `DesktopOnlyGate` for Tier 3. Cutover at `md` (768px); reference frame 390×844.
- QR rendered locally, never via third-party chart APIs (house rule).
- Safe areas: bottom tab bar and full-screen QR respect `env(safe-area-inset-*)`; test iOS Safari toolbar-collapse behavior.
- SSE: reuse `openSseStream` backoff; no polling fallback exists — design the reconnect/stale states, don't invent transport.
- Accessibility: WCAG AA; ≥44px touch targets; `aria-live` on live counters and action results; dialogs/sheets from the existing primitives (focus trap, Escape).
- New primitives expected (confirm against boards): `TabBar`, `DesktopOnlyGate`, `QrDisplay`, list-row. They live in `@idento/ui` with light+dark and tests, per house rules.
- PWA-lite: manifest + icons only; **no service worker/offline in v1** (live-data surface; offline is the KMP app's job).

## 8. Success Metrics

- From unlocking the phone to live monitor numbers: **≤ 10 seconds, ≤ 3 taps** (installed PWA, active session).
- Attendee question answered ("is X checked in?") in **≤ 2 taps + typing** from anywhere in the event workspace.
- Staff login handout via on-screen QR succeeds on the first scan by the KMP app; no printed QR needed on event day.
- **Zero horizontal scrolling** at 390px anywhere in the app — every route is either adapted or gated.
- Zero accidental destructive actions on touch (confirm ceremony holds); manual check-in never silently skips the badge notice.
- Both themes pass AA on all new layouts; e2e mobile-viewport suite green in CI.

## 9. Deliverables

1. **Design boards** (same pipeline/format as `Idento Panel.dc.html`), phone frame 390×844, light + dark where treatment differs:
   - Home (running-event hero + lists), Event overview (pipeline strip + tiles)
   - Monitor phone stack
   - Attendee search list + attendee card (+ action confirms incl. "no badge printed")
   - Staff cards + assign bottom sheet + full-screen staff QR
   - "Add station" provisioning QR (TTL, regenerate)
   - Workspace bottom tab bar + "More" sheet
   - `DesktopOnlyGate` screen (one per flavor: canvas-tool / agent-bound / bulk-data)
   - Shell states on phone: impersonation banner, suspended screen, SSE-stale badge
2. **Primitive specs** for `TabBar`, `DesktopOnlyGate`, `QrDisplay`, list-row (anatomy, states, tokens).
3. **Adaptive rules note**: per-Tier-1-page mapping desktop → phone layout (what stacks, what swaps, what hides).

## 10. Out of Scope

- Any change to the KMP mobile app or desktop kiosk; any scanning/badge-printing from the phone browser.
- Offline mode, service worker, push notifications (candidate for a later phase — needs backend work).
- Mobile versions of: badge editor, CSV import, equipment hub, zone rule builder, full event settings, launch ceremony/station (gated, by design).
- Tablet redesign (board 7e monitor already covers it); desktop layout changes of any kind.
- New backend endpoints or OpenAPI changes.

## 11. Open Questions — RESOLVED (design review, 2026-07-22)

Design boards: `Idento Panel Mobile.dc.html` (board t8, frames 8a–8t) in the "Idento event check-in landing" Claude Design project — generated from this brief.

1. **Workspace phone nav:** → **bottom tab bar** (board 8a). Alternatives 8b (pill row) and 8c (drawer-only) explored and rejected on the boards.
2. **Manual check-in from the attendee card on phone:** → **keep**, with the structural "no badge will be printed" notice in the confirm sheet (board 8j) + a 6s undo toast.
3. **Event info on phone:** → **read-only** in v1 (READ-ONLY chip in the More sheet, board 8n).
4. **PWA installability:** → **v1** — manifest + icons from the logo handoff, no service worker.
5. **Phase numbering:** → **P6.x** (provisional; P5.2/P5.3 stay ahead).
6. **Staff self-service:** → **yes** — a `staff`-role user in a phone browser gets an own-status page + full-screen login QR, nothing more (board 8q); the KMP app remains their working surface.

Resolved during review, beyond the original questions: attendee card is a **state-dependent hybrid** (8i for not-checked-in, 8h for checked-in); **staff sign-in liveness is dropped from v1** (not in the API contract — cards show role/zones/assignment only), which preserves zero backend changes.
