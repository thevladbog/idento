# panel — agent rules

The customer web panel (tenant admin — event creation, attendee/badge/check-in
management). New build from scratch; the old `web/` app is frozen for feature
work while this rewrite runs (see root `AGENTS.md`).

- **UI primitives come only from `@idento/ui`** (`packages/ui`). Never
  reimplement Button/Dialog/Card/etc. here — if one is missing, add it to the
  package (see [packages/ui/AGENTS.md](../packages/ui/AGENTS.md)), don't
  hand-roll it in `panel/`.
- **Form controls:** feature code uses `@idento/ui` form primitives (Select,
  Checkbox, RadioGroup, NumberInput, DatePicker, Input, Switch) — raw native
  `<select>`/`<option>`/`<optgroup>`/`<input type="checkbox"|"radio"|"number"|
  "date">` are banned outside `packages/ui` and ESLint-enforced
  (`no-restricted-syntax` in `panel/eslint.config.js`); a lint error here
  means a real missed native site to migrate, not a rule to weaken.
- **Feature-sliced layout:** `src/app/` (providers, router assembly, shell),
  `src/shared/` (api client, session, i18n, theme, cross-cutting ui glue),
  `src/features/` (screen-level slices — one directory per feature, own
  tests colocated). New screens/features get their own `src/features/<name>/`
  directory, not a growing `src/pages/`. Cross-cutting, feature-agnostic React
  hooks (e.g. `useScrollSpy`) live in `src/shared/hooks/`.
- **Routing:** TanStack Router, code-based (`createRootRoute`/`createRoute`/
  `createRouter` in `src/app/router.tsx`) — not file-based. Protected routes
  nest under the pathless `_app` layout route (`beforeLoad: protectedBeforeLoad`)
  so the session guard and suspended-tenant takeover apply automatically;
  don't add ad-hoc auth checks inside individual route components.
- **Data fetching:** TanStack Query. All calls go through the generated,
  typed `openapi-fetch` client — `api` in `src/shared/api/http.ts` — either
  directly or via the thin per-endpoint wrappers in `src/shared/api/
  client.ts` that call it. Never call `fetch` directly from a
  feature/component. See "API workflow (openapi-first)" below.
  New data hooks use `$api` (`src/shared/api/query.ts`). New tests use the MSW
  helper (`startMswServer` in `src/test/msw.ts`); older hand-stubbed-fetch tests
  are legacy — leave them, don't "fix" them opportunistically.
- **Session:** the only file allowed to touch `localStorage` for auth state
  is `src/shared/api/session.ts`. Never read/write `token`/`user`/`tenants`/
  `current_tenant` directly from a component. Exception: `src/features/
  impersonation/impersonationSession.ts` deliberately manages its own
  `impersonation`/`operator_token` lifecycle and directly reads/writes the
  `token` key as part of restoring the parked operator token on exit — this
  is intentional architecture, not a violation to flag or "fix."
- **i18n:** every user-facing string is a `react-i18next` key, added to
  **both** `src/shared/i18n/en.json` and `ru.json` in the same change.
  `src/shared/i18n/keyParity.test.ts` fails the suite otherwise.
  Key prefixes name the surface that owns the copy (`badgeTestPrint*`,
  `drawerReprint*`, `bulkPrint*`); copy genuinely shared across surfaces
  uses a neutral prefix instead (`printPrinterLabel`, `printNoPrinters`,
  `printSentTo`, `printNoCancelHint`). Don't reference another surface's
  prefixed key — rename it to the neutral prefix first.
- **Physical-output dialogs share ONE dismissal convention:** while a print/
  send is in flight, EVERY dismiss path (X, Escape, outside-click, Cancel) is
  inert until the operation settles, with a visible hint explaining that a
  send can't be recalled. The agent's `/print` 200 is a transport ack only —
  a "cancelled" print can still emerge from the printer, so dismissing
  mid-send hides physical output and invites double prints. See
  `TestPrintDialog.tsx`, `AttendeeDrawer.tsx` (reprint), `BulkBar.tsx`
  (bulk print); don't invent a per-surface variant.
- **Theming:** light/dark only via `@idento/ui` token classes and the
  `.dark` class toggle already wired in `ThemeProvider` — never hardcode a
  color or write `prefers-color-scheme` CSS directly in `panel/`. Sanctioned
  exception: physical-media surfaces (the badge canvas artboard/print
  surfaces — `BadgeCanvas.tsx`, `QrSvg.tsx`, `features/staff/print.css`,
  `ZplPreviewModal.tsx`, `zpl/canvasRasterizer.ts`) use fixed literal colors
  BY DESIGN, not a lapse — they represent a physical medium (paper, thermal
  print, a printed badge) that must render identically regardless of the
  app's theme, where a theme token would flip and misrepresent it (e.g.
  print ink going invisible on a dark-mode-inverted face); each literal
  carries its own rationale comment at the point of use.
- **Verify before finishing any change here:**
  `npm test -w panel && npm run typecheck -w panel && npm run lint -w panel && npm run build -w panel`
  from the repo root.
- **Multi-step async dialogs:** gate every dismiss path (X/Escape/outside-click,
  not just an explicit Cancel) on one comprehensive `isBusy` check covering
  ALL in-flight operations, not just the primary mutation — see
  `ImportWizard.tsx`'s `isStep3Busy`.
- **Readiness invalidation:** any mutation that changes an entity count shown
  in the workspace readiness rail (attendees, zones, staff), OR content a
  readiness step gates on (the badge template — its "badge" step flips on
  saved template content, not a count), must also invalidate
  `READINESS_KEY(eventId)` (`src/features/events/hooks.ts`) alongside its own
  list/resource key — nothing else refetches the readiness query.

## API workflow (openapi-first)

`backend/openapi.yaml` is the contract and it is enforced: Go contract tests
validate every documented operation (coverage-gated in CI), and the panel's
`src/shared/api/schema.d.ts` is generated from it (drift-checked in CI).

- New endpoint: document it in `backend/openapi.yaml` FIRST → implement the
  handler → add a Go contract test (`openapi_contract_*_test.go`, uses
  `validateResponse`) → `npm run generate:api -w panel` → call it through the
  typed `api` client (`src/shared/api/http.ts`).
- Never hand-write a `fetch` against an undocumented path.
- Never hand-edit `schema.d.ts` — regenerate it; on merge conflict, regenerate.
- All requests go through the `api` client so the auth middleware and
  `ApiError` normalization (tenant_suspended, global 401) apply.

## Adaptive layout (P6 mobile companion)

- **One cutover:** phone layouts live below Tailwind `md` (768px); the design
  reference frame is 390×844. Never introduce another breakpoint for
  desktop-vs-phone decisions, and never add `/m/*` routes or user-agent
  sniffing — the URL space is shared and adaptation happens at render time.
- **Tailwind reflow FIRST.** If a layout can stack/reflow with responsive
  classes, do that — no JS. Component swaps are the exception, not the rule.
- **Exactly one sanctioned JS viewport check:** `useIsMobile()`
  (`src/shared/hooks/useIsMobile.ts`), called once per swap pair at the swap
  point (a route gate, a table↔list chooser) — never sprinkled through leaf
  components.
- **Tier-3 surfaces gate, never break.** Desktop-only routes (badge editor,
  event settings, zones, equipment, station/launch, CSV import) render the
  `DesktopOnly` wrapper (`src/shared/ui/DesktopOnly.tsx`) below `md` — a
  render swap on the SAME url via `@idento/ui`'s `DesktopOnlyGate`, never a
  redirect: deep links land on the gate, rotating a tablet past `md` shows
  the real page. Zero horizontal scrolling at 390px is the bar — every route
  is adapted or gated, nothing in between.
- **Touch targets:** interactive controls on phone-only chrome are ≥44×44px
  (`min-h-11`); keep the inflation inside `md:hidden` chrome or
  coarse-pointer scopes so desktop density is untouched.
- **Safe area:** fixed bottom chrome pads with
  `pb-[max(…,env(safe-area-inset-bottom))]`; `panel/index.html` sets
  `viewport-fit=cover` to make those insets real on iOS.
