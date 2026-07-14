# Agent instructions for Idento

For full project context, build steps, and validation commands, see **[.github/copilot-instructions.md](.github/copilot-instructions.md)**.

Code style and conventions are defined in **.cursor/rules/**:

- **Go (backend and agent)**: [.cursor/rules/go-backend.mdc](.cursor/rules/go-backend.mdc)
- **Android / mobile**: [.cursor/rules/android.mdc](.cursor/rules/android.mdc)
- **Web (React/TypeScript)**: [.cursor/rules/web-react.mdc](.cursor/rules/web-react.mdc)

When making changes, run the relevant lint and test steps (see copilot-instructions.md) before considering the task complete.

## Web frontend — panel rewrite & shared UI

Rules for the customer-panel rewrite (spec: [docs/superpowers/specs/2026-07-13-panel-rewrite-design.md](docs/superpowers/specs/2026-07-13-panel-rewrite-design.md)):

- UI primitives (Button, StatusPill, ConfirmDialog, EmptyState, Skeleton, AgentStatus, …) come **only** from `@idento/ui` (`packages/ui`). Never re-implement one inside an app; a missing primitive is added to the package, not to the app.
- Colors only via semantic tokens (`bg-success`, `text-muted-foreground`, …) — hardcoded hex/rgb values are a review-blocker (test-enforced in `packages/ui`).
- Every user-facing string ships in **EN and RU** in the same change; every screen works in **light and dark** themes.
- `web/` is frozen for feature work while the rewrite runs (critical fixes only). Console work targets `web/`; panel work targets `panel/`.
- Scoped rules: [packages/ui/AGENTS.md](packages/ui/AGENTS.md), [panel/AGENTS.md](panel/AGENTS.md).
