# @idento/ui — agent rules

Shared design system for the customer panel, the platform console, and the desktop kiosk.

- **Content boundary:** tokens, presentational primitives, verdict vocabulary — nothing else.
  No data fetching, no router, no i18n dependency: every user-facing string arrives via props.
  Never import from an app (`panel/`, `web/`, `desktop/`).
- **React compat:** peerDependency `react >=18` — the desktop kiosk runs React 18.
  Do not use React-19-only APIs.
- **Colors:** define or change them only in `src/theme.css` (`:root` + `.dark` + `@theme inline`).
  Components consume token-backed Tailwind classes; `no-hardcoded-colors.test.ts` fails the suite
  on any hex/rgb literal in `src/`.
- **Both themes, always:** every component must render correctly in light and dark.
  Status/verdict UI is always icon + text + color (WCAG 1.4.1 — never color alone).
- **Icons:** lucide-react only. No emoji as UI.
- **Verify:** `npm test -w @idento/ui && npm run typecheck -w @idento/ui && npm run lint -w @idento/ui`
  from the repo root before finishing any change here.
