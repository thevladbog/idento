---
applyTo: "web/**"
---

# Web (React / TypeScript)

- React 18, TypeScript, Vite, Tailwind v4, shadcn/ui (Radix), React Router 7
- Structure: `src/pages/`, `src/components/` (including `ui/` for shadcn), `src/hooks/`, `src/lib/`, `src/types/`
- API client: `@/lib/api` (Axios); forms: react-hook-form + zod; i18n: i18next
- Use functional components and hooks; avoid `any`; type all props
- Lint: `cd web && npm run lint`; typecheck: `npx tsc --noEmit`
- Follow `.cursor/rules/web-react.mdc` for conventions
