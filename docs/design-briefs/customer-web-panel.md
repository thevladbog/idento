# Design Brief: Idento Customer Web Panel (Tenant Admin)

**Date:** 2026-07-11
**Scope:** the customer-facing web app in `web/` — everything outside `/super-admin`. This is the "main panel brief" anticipated by [saas-tenant-admin.md](saas-tenant-admin.md) (§7, §10).
**Inputs:** UI inventory of `web/src`, audit findings ([web-qual](../audit/findings/web-qual.md), [web-bug](../audit/findings/web-bug.md), [web-sec](../audit/findings/web-sec.md)), [DUAL_DISTRIBUTION_REWORK.md](../DUAL_DISTRIBUTION_REWORK.md), console-redesign batches 1–3, mobile redesign M1–M2.

## 1. Project Overview

**Product:** the tenant's own admin panel of Idento — where an organizer's team runs the full event lifecycle: create an event → import attendees (CSV) → design and print badges → configure zones, staff, and equipment → run check-in on event day → monitor results. Today it spans auth (login / register / QR staff login), Dashboard, Events + a six-section event workspace (Attendees, Zones, Badge Template, Staff, Check-in, Settings), Users, Equipment, Organization Settings, and a fullscreen check-in station.

This brief covers its redesign. Unlike the platform console, this panel ships in **both editions** — SaaS and on-prem — and must become edition-aware (the P2.2 "frontend mode awareness" work lands with this redesign; today the app never reads `GET /api/instance`).

**Relationship to sibling surfaces:** the platform console (dark-chrome, `/super-admin`) has its own brief and shipped design system pieces this panel should inherit; the mobile app (KMP) and desktop kiosk (Tauri) are the dedicated event-day devices with their own redesign tracks. The web check-in station remains the browser-based registration-desk surface.

## 2. Users & Context of Use

- **Two tempos, one product.** Preparation happens at a desk, weeks ahead: dense forms, tables, an editor — calm and information-rich. Event day happens standing at a venue entrance: glanceable screens, huge targets, seconds matter, and mistakes are public (a wrong badge prints in front of the guest). The redesign must serve both without compromising either.
- **Roles:** tenant `Admin` and `Manager` do preparation; `Staff` log in via QR tokens with minimal training and touch only event-day surfaces. Users may belong to several organizations (org switcher in the shell).
- **First-run is a business moment.** In SaaS, a self-signed-up trial organizer must get from an empty account to a check-in-ready event without reading docs — trial conversion depends on it. Today the six event sections are flat, disconnected, and give no signal of what's done or what's next.
- **Hardware is part of the UX.** Printing and scanning go through a local Go agent (`localhost:3000`); its connectivity, printer state, and scanner state leak into almost every flow and today fail silently (empty lists, vanished printers).

## 3. Core Objects & Information Architecture

Objects: **Event** (center of gravity), Attendee, Badge template, Zone (+ access rules, staff assignments), Team member, Equipment (printers/scanners via agent), Organization (+ subscription/usage in SaaS).

Current IA problems, in order of pain:

- **Dashboard is a dead end** — five static navigation tiles, zero data ([Dashboard.tsx](../../web/src/pages/Dashboard.tsx)). An organizer's real questions — "is my event ready?", "how is check-in going right now?" — have no home.
- **The event workspace has no spine.** Six sidebar links with no readiness state, no suggested order, and empty sections that don't teach. The badge editor and check-in link live at the same visual rank as Settings.
- **Org-level vs event-level is muddled.** Equipment is global but consumed per-event; Users (team) is global while Staff is per-event; the same person configures both with no map.
- **Check-in entry is an afterthought.** A buried "Launch fullscreen" card that today binds to `events[0]` regardless of which event you came from (WEB-QUAL-02) and reads station settings from `localStorage` that silently diverge from Event Settings (WEB-QUAL-03).

Target IA:

- **Home = operational.** Next/running event with readiness state and a live check-in pulse when an event is active; recent events; quick actions. (Whether Home is a page or Events-list-as-home is a design decision — see Open Questions.)
- **Event workspace with a readiness model.** The six sections become a visible pipeline — Attendees → Badge → Zones → Staff → Equipment check → Check-in — each with a readiness chip (empty / in progress / ready), aggregating to an "event is ready" state. Zones stay optional (single-zone events must not pay a complexity tax).
- **Org level:** Team, Equipment, Organization settings (+ usage vs plan limits in SaaS).
- **Check-in launch is a ceremony:** explicit event confirmation, station settings fetched from the server (one source of truth), printer check, then fullscreen.

## 4. Key Design Problems to Solve

- **One status language.** Today there are four bespoke role/status badge treatments, emoji-as-status (`🚫`, `✓`), and color-only verdicts (whole-screen green/yellow/red on check-in). Define a single token-based status/verdict vocabulary — shared semantics with the mobile app's `VerdictBand` (`allowed` / `no_access` / `not_registered` / already-checked-in) — always icon + text + color, WCAG 1.4.1 clean, with `aria-live` on the kiosk verdict swap.
- **Scale honestly.** Attendee lists fetch everything and filter in memory; there is no pagination anywhere. Design every list (attendees first) for server-side search/filter/pagination and thousands of rows: sticky bulk actions, virtualized tables where needed, CSV import with progress and per-row error reporting (large files currently freeze the tab — WEB-BUG-07).
- **Destructive actions deserve ceremony.** Four surfaces still use native `confirm()` while a superior typed-confirm ceremony (`useTypedConfirmGate`, `ConfirmActionDialog`) already exists but is console-only. Promote it: one confirm component, severity-tiered (plain confirm → typed confirm for data loss: delete attendees, regenerate codes, delete zone, delete event — currently a permanently disabled placeholder button).
- **The badge editor must become a real tool.** 1,135 lines with three hand-rolled `fixed inset-0` modals (no focus trap/Escape), hardcoded Russian labels, hardcoded `#009246` canvas chrome, and no unsaved-changes guard (WEB-BUG-03: navigation silently destroys a layout). Redesign as a proper editor shell: canvas + panels (elements, properties, label setup), design-system dialogs, dirty-state guard, autosave or explicit save model, i18n'd copy, printer-font flow integrated with agent state.
- **Check-in correctness is a UX property.** Duplicate scans double-print (WEB-BUG-01/02), failed scans vanish after a 3s toast, and there is no offline/degraded handling (an orphaned `offlineMode` i18n key ships with no feature). Design: debounced single-flight scanning, "already checked in" as a first-class verdict (with timestamp + reprint action, never an auto-reprint), a persistent recent-scans rail so nothing is lost, and an explicit degraded-connection banner with retry semantics. Full offline queueing stays with mobile/desktop kiosks.
- **Make the agent a citizen of the UI.** One `AgentStatus` model (connected / disconnected / stale) surfaced consistently: in Equipment, in the badge editor's print controls, in the check-in ceremony. Guided setup flows per device class (network printer, USB/COM scanner, camera) instead of one 1,002-line wall; saved printers must survive reloads (WEB-QUAL-04) and the "default printer" rule must be single-sourced (WEB-QUAL-05).
- **Edition & subscription awareness.** On-prem: hide self-signup, plans, and platform links entirely (shell reads `/api/instance`). SaaS: show usage vs limits (reuse the console's meter utilities/`BarRow`), trial state, and a human-readable **tenant-suspended** screen for `403 tenant_suspended` (today: raw failure); keep the impersonation banner exactly as specced in the console brief — it belongs to this app's design system.
- **States are a contract, not an accident.** One shared loading (token-based skeletons — the only skeleton today is hardcoded `bg-gray-200`, invisible in dark mode), one `EmptyState` pattern (icon + explanation + CTA that teaches the pipeline), one error pattern (inline + retry; errors currently go to `console.error` and the UI shows nothing), plus a top-level ErrorBoundary so one bad date never white-screens check-in (WEB-BUG-08).
- **Responsive stance.** Primary nav is `hidden md:flex` with no hamburger — on a phone the app is chromeless; the event sidebar is a fixed 256px column. Decide and design: desktop-first for prep, but nav collapses to a drawer, and check-in + monitoring are fully usable on a tablet.

## 5. Check-in Station (highest-stakes surface)

The fullscreen station gets its own spec: launch ceremony (event + station settings from server + printer confirm) → scan loop (hardware scanner via `useScanner`, camera, or search-first fallback) → verdict screen (XXL, icon+text+color, auto-dismiss with countdown, manual dismiss) → recent-scans rail with per-entry reprint/undo affordances → header with live counters (checked-in / total, per-zone when zones exist) → degraded-mode banner. Kiosk chrome: no app nav, explicit exit, wake-lock awareness. Settings changes made at the station write back to the server, not `localStorage`.

## 6. Visual Identity

- **Same brand, calmer expert surface.** Keep the token system: green `--primary: hsl(152 100% 29%)` (dark: `152 50% 42%`), shadcn variables, `--radius: 0.5rem`, light + dark. The customer panel keeps **light chrome** — the dark top-chrome is the console's signature; the two contexts must stay unmistakably distinct.
- **Typography is currently nothing.** No font is loaded at all (system default) and heading sizes drift per page. Adopt **Inter** (mobile already standardized on it) with a defined scale (page title / section / card title / body / caption) — one shared type ramp for the panel.
- **Add the missing semantic tokens.** Only `--destructive` exists today, which is *why* 17 files hardcode raw greens/ambers/blues (50 hits in CSV import alone). Introduce `success` / `warning` / `info` token families (light+dark) plus the shared verdict set, then purge hardcoded hexes including `#009246` in the Konva canvas.
- **Density:** comfortable for prep surfaces (organizers are occasional users, not daily operators), compact for data tables, XXL for kiosk verdicts.
- **Iconography:** lucide only; no emoji as UI. Status chips never rely on color alone.
- **Language:** full EN/RU parity via i18n keys — including zod validation messages (now hardcoded EN) and the badge editor (now hardcoded RU).

## 7. Technical & UX Constraints

- Stack: React 18 + Vite + Tailwind v4 (CSS-first tokens; migrate the hand-rolled `@layer utilities` re-declarations to proper `@theme` mapping as part of foundation), vendored shadcn/ui + Radix, lucide, sonner toasts, RHF + zod, react-i18next (flat keys, EN/RU), Konva (badge canvas), PapaParse (CSV), local agent API for devices.
- **This brief owns the shared primitives** the console brief borrows: Tabs and DataTable (sort/filter/server-side pagination), plus PageHeader, StatusPill, EmptyState, Skeleton, ConfirmDialog, Stepper/Wizard, Meter, AgentStatus. Currently absent primitives: tabs, data-table, skeleton, pagination, breadcrumb, form wrapper, radio-group, progress.
- Reuse from the console redesign where semantics match: `useTypedConfirmGate`, meter utilities (`lib/meters.ts`, `BarRow`), `useScrollSpy` (long-scroll + anchor rail pattern for Event Settings), sheet, command palette infra.
- Server-side list endpoints (attendees search/pagination) require backend coordination — design must not assume in-memory data.
- Session model: JWT in `localStorage` today, flagged to move (WEB-SEC-04/05); don't couple designs to synchronous client-side auth state; route guards may re-verify server-side. QR codes are always rendered locally (never third-party chart APIs).
- Concurrency: save flows must stop full-PUTting stale snapshots (WEB-BUG-04) — design saves as scoped updates with conflict awareness where relevant (badge editor, event settings).
- CSV import must handle Windows-1251 gracefully (encoding detection or explicit choice — WEB-BUG-05) and parse off the main thread with progress.
- Accessibility: WCAG AA; all dialogs from the Dialog primitive (focus trap, Escape); keyboard-complete tables and editor panels; `aria-live` for verdicts and toasts.
- Tests: vitest + Testing Library infra exists (added by console batches); redesigned components ship with tests — the audit flagged zero web coverage as the main refactor risk.

## 8. Success Metrics

- A new organizer reaches a check-in-ready event (attendees imported, badge designed, station tested) in **≤ 30 minutes without documentation**; readiness state visible at every step.
- Event day: scan → verdict **< 1s perceived**; **zero wrong-event check-ins** (explicit binding); a repeated scan **never double-prints**; no scan outcome is lost silently (recent-scans rail).
- Attendee management stays fluid at **5,000+ attendees** (server-side operations, no full-list fetches).
- WCAG AA on all redesigned surfaces; every status readable without color; zero native `confirm()` left.
- 100% of UI strings through i18n keys in both EN and RU; one StatusPill, one ConfirmDialog, one EmptyState implementation panel-wide.

## 9. Deliverables

1. **Foundation:** semantic token extension (success/warning/info + verdict set), Inter type ramp, dark/light parity, `@theme` migration — documented in both themes.
2. **Component kit:** DataTable, Tabs, PageHeader, StatusPill, EmptyState, Skeleton, ConfirmDialog (severity-tiered), Stepper/Wizard, Meter, AgentStatus indicator, mobile nav drawer.
3. **App shell:** global nav (desktop + drawer), org switcher, edition-aware menu, impersonation banner integration, suspended-tenant screen.
4. **Home:** operational dashboard (or Events-as-home per decision) with readiness + live pulse.
5. **Event workspace:** readiness-driven navigation + section designs — Attendees at scale (list, filters, bulk ops, import wizard with progress/error report, attendee card with movement timeline), Zones (CRUD, access rules, staff assignments), Staff, Settings (decomposed long-scroll with anchor rail, real danger zone).
6. **Badge editor:** full redesign — editor shell, element/property panels, fonts & printer flows, save model with dirty guard, ZPL preview.
7. **Check-in station:** launch ceremony, scan loop, verdict screens, recent-scans rail, degraded mode, station settings (server-sourced).
8. **Equipment hub:** agent state model, guided per-device setup and test flows.
9. **Auth set:** login / register (SaaS-only) / QR staff login, password strength signal, edition awareness.
10. **Interaction spec:** loading/empty/error contracts, toast usage, confirmation tiers, keyboard patterns.

## 10. Out of Scope

The platform console (own brief; batches 1–3 shipped), the marketing landing, mobile apps and the desktop/Tauri kiosk (own redesign tracks), customer-facing billing/upgrade and payment-provider UI (post-v1; billing is operator-side in the console), license-key activation (deferred in the dual-distribution plan), full offline-first web check-in (offline ownership sits with mobile/desktop kiosks; web gets graceful degradation only), and backend feature work beyond the contracts listed in §7.

## 11. Open Questions (for product owner)

1. **Home:** dedicated operational dashboard, or Events list as the landing surface with a live strip for the running event?
2. **Web check-in ambition:** long-term first-class station (invest in browser scanner/camera UX) or registration-desk fallback while mobile/desktop kiosks are primary?
3. **Tablet:** target for prep surfaces too, or only for check-in + monitoring?
4. **Team model:** keep global Users + per-event Staff as two surfaces, or unify into one Team area with per-event assignment?
5. **Attendee card:** does v1 need a full attendee detail view (timeline, per-zone access editing), or do row-level dialogs suffice?
