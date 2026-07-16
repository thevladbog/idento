# panel — agent rules

The customer web panel (tenant admin — event creation, attendee/badge/check-in
management). New build from scratch; the old `web/` app is frozen for feature
work while this rewrite runs (see root `AGENTS.md`).

- **UI primitives come only from `@idento/ui`** (`packages/ui`). Never
  reimplement Button/Dialog/Card/etc. here — if one is missing, add it to the
  package (see [packages/ui/AGENTS.md](../packages/ui/AGENTS.md)), don't
  hand-roll it in `panel/`.
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
- **Theming:** light/dark only via `@idento/ui` token classes and the
  `.dark` class toggle already wired in `ThemeProvider` — never hardcode a
  color or write `prefers-color-scheme` CSS directly in `panel/`. Sanctioned
  exception: physical-media surfaces (the badge canvas artboard/print
  surfaces — `BadgeCanvas.tsx`, `QrSvg.tsx`, `features/staff/print.css`) use
  fixed literal colors BY DESIGN, not a lapse — they represent a physical
  medium (paper, thermal print, a printed badge) that must render
  identically regardless of the app's theme, where a theme token would flip
  and misrepresent it (e.g. print ink going invisible on a dark-mode-inverted
  face); each literal carries its own rationale comment at the point of use.
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
