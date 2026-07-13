# Customer Panel Rewrite — Design

**Date:** 2026-07-13
**Status:** approved in brainstorm; awaiting spec review
**Scope owner:** customer web panel (tenant admin) — everything the current `web/` app serves **outside** `/super-admin`.
**Inputs:** [design brief](../../design-briefs/customer-web-panel.md) (2026-07-11), Claude Design board *Idento Panel.dc.html* (project `165a9ba5-4bb1-4ede-9048-546ccb1742af`, https://claude.ai/design/p/165a9ba5-4bb1-4ede-9048-546ccb1742af?file=Idento+Panel.dc.html), current `web/` inventory, `backend/openapi.yaml`, audit findings WEB-BUG/QUAL/SEC.

## 1. Goal

Rebuild the customer panel from scratch as a new application implementing the *Idento Panel* design board end to end — new visual foundation (semantic tokens, Inter type ramp, one status language), new IA (events-list home with live strip, readiness-pipeline event workspace), and the event-day surfaces (check-in station, monitor, equipment hub) done right. Backend work ships in the same initiative: each phase carries the Go endpoints it needs.

The platform console (`/super-admin`) is **not** part of this rewrite. It recently completed its own redesign (batches 1–3) and keeps living in the current `web/` package. Its own design file (*Idento Console.dc.html*) is out of scope here.

## 2. Decisions log

| Decision | Choice |
|---|---|
| Stack | **Vite SPA**: React 19 + TypeScript strict, TanStack Router + TanStack Query, Tailwind v4, shadcn/ui, openapi-generated API client. No Next.js — the panel is auth-gated (no SEO), and SSR would force a Node runtime into every on-prem install, breaking the static-nginx + `env.js` model. |
| Backend | Full-stack, phased: each frontend phase lands with the endpoints it needs. |
| Home | Board option **1c** — live-strip hero + Upcoming/Past cards, action-first copy, readiness bullets (borrowed from 1e) on upcoming-event cards. |
| Event workspace | Board option **1f** — left rail as ordered readiness pipeline with chips, Overview "what's next", launch ceremony pinned at the bottom, check-in locked until required steps ready. |
| Check-in station | Board option **2c** — split layout with persistent recent-scans rail (last 50, reprint/undo). Mode **2d** (search-first registration desk + degraded-connection banner) included as a station mode. |
| Badge editor | Board option **4a** — classic three-pane (elements / canvas / properties). |
| Attendee card | Board option **3e** — drawer over the table for v1; full detail page (3d) deferred. |
| Shared UI package | **Yes, from day one:** `packages/ui` (`@idento/ui`) — internal npm-workspace package, source-imported (no build/publish step). Three roadmap consumers share one design language: this panel, the console rewrite (*Idento Console.dc.html*), the desktop kiosk redesign (*Idento Kiosk.dc.html*; kiosk is already React 18 + Vite + Tailwind v4). |
| Localization | **RU + EN are both first-class from day one** — every UI string through i18n keys in both languages (zod validation messages included), language switcher in the shell, automated key-parity check in CI. No phase ships single-language screens. |
| Theming | **Light + dark shipped from day one**, user-switchable with system-preference default; every `@idento/ui` component is token-based and validated in both themes (kit stories/tests render both). |
| AI agent rules | Working rules for AI agents are a **P0 deliverable**: new `.cursor/rules/ui-package.mdc`, updates to root `AGENTS.md` and `.github/copilot-instructions.md` (see §3.4). |
| Auth/session | Keep JWT-in-localStorage for v1 (WEB-SEC-04/05 migration is a separate track). Token storage isolated behind one adapter so an httpOnly-cookie move later touches one module. |
| Prior product decisions (from the design chat, reused verbatim) | Home = events list + live strip; web check-in = registration-desk fallback (kiosks primary); tablet targets check-in + monitoring only; global Users (Team) and per-event Staff stay separate surfaces. |

## 3. Architecture

### 3.1 Package & deployment

- New top-level package **`panel/`** plus the shared **`packages/ui`** (`@idento/ui`). Root `package.json` declares `workspaces: ["packages/*", "panel"]`; `web/`, `landing/`, and `desktop/` keep their standalone installs and join the workspace only when their own initiatives adopt the package. `web/` stays untouched during development.
- `panel/`'s Docker build context moves to the repo root so the image sees `packages/`.
- **One image, two SPAs** at cutover: a combined nginx image serves the new panel at `/` and the console at `/super-admin/`. The only change to the old app is `base: '/super-admin/'` in its Vite config so console assets move under `/super-admin/assets/` (no asset-path collision). `docker-compose` topology (SaaS and on-prem) does not change — still a single `web` service.
- Runtime config: same proven `env.js` + envsubst-on-start pattern (unprivileged nginx, `PUBLIC_API_URL` injected at container start).
- Edition awareness: shell reads `GET /api/instance` once; on-prem hides register/trial/plans and shows the version tag; SaaS shows trial chip and usage meters. Suspended tenant (`403 tenant_suspended`) renders the dedicated screen (board 7d); impersonation banner per the console spec.

### 3.2 Code structure (feature-sliced)

```
packages/ui/    # @idento/ui — shared design system (see 3.3):
                # tokens (@theme CSS), primitives, verdict vocabulary.
                # Deps: react (peer, >=18), radix, cva, tailwind-merge, lucide.
                # NO api hooks, NO i18n dep (strings via props), NO app shells,
                # NO feature components.
panel/src/
  app/          # providers, router assembly, shell (nav, org switcher, drawers)
  shared/       # api client (generated from backend/openapi.yaml), agent client
                # (localhost:3000), i18n, lib, panel-only ui glue
  features/     # auth, events, workspace, attendees, badge-editor, checkin,
                # monitor, equipment, zones, staff, settings, org
```

- **Routing:** TanStack Router, file-based; auth and edition guards at loader level (redirect before render). Route tree: auth routes, app shell routes (`/events`, `/events/$eventId/*` workspace, `/team`, `/equipment`, `/organization`), chrome-less routes (station, monitor, QR login).
- **Data layer:** `backend/openapi.yaml` → `openapi-typescript` + `openapi-fetch`; TanStack Query hooks per feature. The spec file is the contract: new endpoints land in openapi.yaml first, client is regenerated.
- **Live data:** SSE for the monitor and home live strip, with polling fallback.
- **Agent:** one `AgentStatus` model (connected / stale / disconnected) polled from the local Go agent; consumed by Equipment hub, badge-editor print controls, and the launch ceremony.
- **Heavy work off the main thread:** CSV parsing (PapaParse) in a Web Worker.
- **Canvas:** Konva / react-konva for the badge editor (kept), neutral artboard chrome (no hardcoded `#009246`).

### 3.3 Design foundation (board section 1a/1b) — lives in `@idento/ui`

- Semantic token families `success / warning / info` joining `--destructive`, light + dark; shared kiosk verdict set (allowed / no_access / not_registered / already_checked_in — same semantics as mobile `VerdictBand`). Tokens are theme-able from day one: the console's dark chrome and the kiosk's XXL density are token/variant overrides, not separate components.
- Inter with the defined ramp (page title 20/700 … mono 10.5). Light chrome — dark top bar remains the console's signature.
- Component kit: StatusPill (always icon + text + color), ConfirmDialog (two tiers, typed confirm for data loss), EmptyState (teaches the pipeline), token-based Skeleton, AgentStatus indicator, DataTable (server-side sort/filter/pagination), Stepper/Wizard, Meter, PageHeader, Tabs, XXL verdict components. The mobile nav drawer and app shells stay in `panel/` — chrome is per app.
- Package discipline: `@idento/ui` takes all strings via props (no i18n dependency), exposes no data fetching, and is guarded by lint rules against imports from any app.

### 3.4 Rules for AI agents (P0 deliverable)

The repo's agent-instruction chain (`AGENTS.md` → `.github/copilot-instructions.md` → `.cursor/rules/*.mdc`) gets the new-world rules so every future agent session lands correctly:

- New rule file `.cursor/rules/ui-package.mdc` covering: primitives (StatusPill, ConfirmDialog, EmptyState, DataTable, …) come **only** from `@idento/ui` — never re-implemented inside an app; a missing primitive is added to the package, not to the app; package content boundary (no i18n/api/feature imports, strings via props); colors only via semantic tokens — hardcoded hex values are a review-blocker; every new UI string lands in EN **and** RU in the same change; every component/screen must work in light **and** dark theme.
- `.github/copilot-instructions.md`: npm-workspace layout (`packages/ui`, `panel/`), install/build/lint/test commands for both, and the note that `web/` is frozen for feature work (critical fixes only) while the rewrite runs — console work targets `web/`, panel work targets `panel/`.
- Root `AGENTS.md`: link the new rule file next to the existing Go/Android/web ones.
- The same rules apply to the future console and kiosk initiatives when they adopt `@idento/ui`.
- No emoji as UI, lucide icons only; WCAG AA; all dialogs on the Dialog primitive; `aria-live` on verdicts; full EN/RU parity including zod messages.

## 4. Backend plan (Go)

**Preserved as-is (verified in code):** per-event font upload/list (`handler/fonts.go`), API keys (`handler/api_keys.go`, `middleware/api_key.go`), and the Cyrillic label-printing path — text rasterized with uploaded TrueType/OpenType fonts into ZPL graphics. This rendering behavior is a hard requirement; the rewrite must not regress it.

**Pre-work:** `backend/openapi.yaml` is stale (fonts and API-keys endpoints exist in code but not in the spec). P0 brings the spec to truth for every endpoint the panel consumes; from then on openapi.yaml is the source the client is generated from.

**New/extended endpoints, by phase:**

1. **Attendees at scale (P2):** server-side `search / zone / status / page / per_page` + total count on the event attendees list; bulk-import response extended with per-row errors (row number, data, problem) so the wizard's step 3 is honest.
2. **Check-in settings & stations (P4):** event-level check-in settings on the server (print-on-check-in, verdict auto-dismiss, scan input, manual search) — GET/PUT, replaces localStorage; station registration (name, zone binding, heartbeat) feeding the monitor.
3. **Check-in correctness (P4):** idempotent check-in (repeat scan returns `already_checked_in` with first-scan metadata; never triggers a second print), undo check-in, reprint as an explicit logged action.
4. **Live monitor (P4):** SSE stream + snapshot endpoint — totals, per-zone, per-station counters, scans/min, recent-scans feed.
5. **Device registry (P4):** per-machine saved printers/scanners and the single default-printer rule stored server-side (keyed by agent machine id) — survives reloads.
6. **Readiness aggregate (P1):** per-event readiness (attendees / badge / zones-optional / staff / equipment-check), zones excluded when skipped; "ready" unlocks check-in launch.
7. **Zone access rules (P2):** rule-per-zone (e.g. `Category is VIP`), re-evaluated on import.

## 5. Phases

Each phase is its own spec → plan → PR cycle (like the console batches). Cutover happens only at P5; until then production is untouched.

- **P0 Foundation.** npm workspaces root + `packages/ui` scaffold; `panel/` scaffold, CI, Dockerfile (repo-root build context); tokens + type ramp (1a) and component kit (1b) in `@idento/ui`; app shell (nav, org switcher, edition awareness, suspended screen, impersonation banner, mobile drawer, language + theme switchers — 7d/7f); auth set (login / register SaaS-only / QR staff login — 7a–7c); i18n infrastructure with EN/RU from the first screen; light/dark theming wired through tokens; AI-agent rules (§3.4); openapi truth-up + client generation.
- **P1 Events & workspace spine.** Home 1c with live strip (polls existing counters in P1; upgrades to SSE when backend #4 lands in P4); event CRUD; workspace 1f with readiness pipeline (backend #6 — the equipment-check step stays "not done" until its P3/P4 wiring exists); Event Settings 6a (anchor rail, scoped per-card saves — no full-PUT snapshots, fonts UI and API-keys UI on existing endpoints, real danger zone through typed confirm).
- **P2 People & data.** Attendees at scale (backend #1): DataTable at 5,000+, bulk bar, import wizard (worker, Windows-1251 auto-detect with override, progress, per-row error report), attendee drawer 3e; Zones 6b (+ rules, backend #7); Staff 6c (QR logins, print cards, revoke/regenerate).
- **P3 Badge editor.** Three-pane shell 4a; save model — scoped PATCH, four save states incl. server conflict, dirty-state guard on navigation/tab close/Escape; ZPL preview 4d ("the truth" render); printer-font flow with first-class Cyrillic coverage checks; test print via agent.
- **P4 Event day.** Launch ceremony 2a (backend #2); scan loop 2c with persistent recent-scans rail + 2d search-first/degraded mode (backend #3); tablet monitor 7e + SSE (backend #4); Equipment hub 5a–5d with guided per-device setup flows and device registry (backend #5).
- **P5 Parity & cutover.** A11y audit (WCAG AA), EN/RU parity check, e2e suite green, performance validation at 5k+ attendees, combined nginx image (console `base` change), panel routes removed from the old `web/` app, docs.

## 6. Quality

- **Tests:** vitest + Testing Library + MSW for components/hooks (kit components ship with tests); Playwright e2e for critical flows — login, create event, CSV import happy path, scan loop with emulated scanner input, badge-editor dirty guard. CI-gated.
- **Error contract:** route-level ErrorBoundaries (a bad date never white-screens the station); load errors render inline with retry — never toasts; toasts only for action feedback; token-based skeletons.
- **i18n:** every string through react-i18next keys, EN/RU; zod error map through i18n; automated key-parity check in CI; language switcher in the shell (persisted per user).
- **Theming:** light + dark from day one, user-switchable (system default); kit components tested in both themes; no hardcoded colors anywhere (lint-guarded).
- **Success metrics (from the brief):** new organizer reaches a check-in-ready event in ≤ 30 min without docs; scan → verdict < 1 s perceived; zero double-prints; no scan outcome silently lost; attendee lists fluid at 5,000+; zero native `confirm()`; one StatusPill / ConfirmDialog / EmptyState implementation panel-wide.

## 7. Out of scope

Platform console rewrite (own design file, own track); marketing landing; mobile/desktop kiosk apps; customer-facing billing/payment UI; license-key activation; full offline-first web check-in (graceful degradation only — offline ownership stays with mobile/desktop kiosks); JWT → httpOnly-cookie session migration (separate security track).

## 8. Risks & mitigations

- **openapi.yaml drift** — mitigated by P0 truth-up and "spec-first" rule for new endpoints; client regeneration in CI catches divergence.
- **Two SPAs, one origin** — asset collision avoided via console `base: '/super-admin/'`; verified in P5 with a staging compose run of the combined image.
- **Long parallel life of old and new panels** — old `web/` receives only critical fixes during the rewrite; no feature work lands there.
- **Scale claims** — P2 exits with a seeded 5k-attendee dataset test, not a promise.
- **Cyrillic printing regression** — P3 exit criteria include a printed test matrix (built-in vs uploaded fonts × RU/EN samples) against the preserved raster path.
- **Shared-package coupling** — `@idento/ui` keeps `react >=18` as a peer dependency (kiosk is on React 18) and avoids React-19-only APIs; content boundary (no i18n/api/feature code) enforced by lint so three apps' release cycles stay independent.
