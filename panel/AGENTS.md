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
  directory, not a growing `src/pages/`.
- **Routing:** TanStack Router, code-based (`createRootRoute`/`createRoute`/
  `createRouter` in `src/app/router.tsx`) — not file-based. Protected routes
  nest under the pathless `_app` layout route (`beforeLoad: protectedBeforeLoad`)
  so the session guard and suspended-tenant takeover apply automatically;
  don't add ad-hoc auth checks inside individual route components.
- **Data fetching:** TanStack Query. Auth/session calls go through
  `src/shared/api/client.ts`'s hand-written `fetch` wrappers — do not call
  `fetch` directly from a feature/component. (A generated OpenAPI client
  lands in phase P0.3; once it exists, new endpoints should use it instead
  of hand-written wrappers.)
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
  color or write `prefers-color-scheme` CSS directly in `panel/`.
- **Verify before finishing any change here:**
  `npm test -w panel && npm run typecheck -w panel && npm run lint -w panel && npm run build -w panel`
  from the repo root.
