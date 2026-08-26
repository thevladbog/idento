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
- Feature code uses `@idento/ui` form primitives (Select, Checkbox, RadioGroup, NumberInput, DatePicker, Input, Switch) — raw native `<select>`/`<option>`/`<optgroup>`/`<input type="checkbox"|"radio"|"number"|"date">` are banned outside `packages/ui` (ESLint-enforced in `panel/eslint.config.js`).
- Colors only via semantic tokens (`bg-success`, `text-muted-foreground`, …) — hardcoded hex/rgb values are a review-blocker (test-enforced in `packages/ui`).
- Every user-facing string ships in **EN and RU** in the same change; every screen works in **light and dark** themes.
- `web/` is frozen for feature work while the rewrite runs (critical fixes only). Console work targets `web/`; panel work targets `panel/`.
- Scoped rules: [packages/ui/AGENTS.md](packages/ui/AGENTS.md), [panel/AGENTS.md](panel/AGENTS.md).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
