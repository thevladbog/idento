# Idento – Repository instructions for GitHub Copilot

## What this repository is

Idento is an **event check-in system** with badge printing, QR codes, and offline mobile support. It is a **monorepo** with:

- **backend/** — Go 1.25 API (Echo, PostgreSQL, Redis, JWT)
- **agent/** — Go printing agent (serial/network printers, scanners)
- **web/** — React 18 admin UI (TypeScript, Vite, Tailwind v4, shadcn/ui)
- **mobile/** — Kotlin Multiplatform app (Jetpack Compose on Android, Hilt, offline-first)

Use **Go 1.25** and **Node.js 20+** for backend/agent and web. See [DEVELOPMENT.md](DEVELOPMENT.md) for full setup.

## Build and validation

### General (from repo root)

- `make help` — list all commands
- `make check-deps` — verify Go, Node, Docker
- `make lint` — lint Go code (backend + agent) via golangci-lint
- `make test` — run Go tests for backend and agent
- `make test-coverage` — Go tests with coverage and race detection
- `make build-all` — build backend and agent binaries into `build/`
- `make docker-up` / `make docker-down` — start/stop Docker (PostgreSQL, Redis)
- `make dev` — start all dev services (scripts/start-all.sh or start-all.ps1)

Always run `make lint` and `make test` before committing when changing Go code.

### Backend and agent (Go)

- Lint: from root `make lint`, or in directory: `golangci-lint run` (backend: `./internal/...`, agent: `./...`)
- Test: `cd backend && go test ./...` and `cd agent && go test ./...`
- Build: `make build-backend` and `make build-agent`, or `cd backend && go build .` and `cd agent && go build .`

### Web

- Install: `cd web && npm ci`
- Build: `cd web && npm run build`
- Lint: `cd web && npm run lint`
- Type check: `cd web && npx tsc --noEmit`

### Mobile

- Build and test from `mobile/android-app/` with Gradle (e.g. `./gradlew assembleDebug`, `./gradlew test`). See CI and [DEVELOPMENT.md](DEVELOPMENT.md) for exact steps.

## Project layout

- **backend/** — `cmd/`, `internal/handler`, `internal/store`, `internal/models`, `internal/middleware`, `migrations/`, `openapi.yaml`
- **agent/** — `internal/printer`, `internal/scanner`, `main.go`, `openapi.yaml`
- **web/** — `src/pages/`, `src/components/`, `src/hooks/`, `src/lib/`, `src/types/`, `vite.config.ts`
- **mobile/** — `android-app/` (Compose app), `shared/` (KMP), `iosApp/`
- **scripts/** — start-all, stop-all, seed, lint-backend (per platform)
- **docs/** — guides and migration notes

Linting and config: backend/agent use [.golangci.yml](.golangci.yml) at repo root; web uses [web/eslint.config.js](web/eslint.config.js).

## CI

On push/PR to main or master, [.github/workflows/ci.yml](.github/workflows/ci.yml) runs:

- **Path filters**: backend+agent, web, mobile — only changed areas are built/tested
- **Go**: lint (golangci-lint), test with race and coverage, build
- **Web**: npm ci, typecheck (tsc --noEmit), lint (npm run lint), build
- **Mobile**: Gradle build (and tests as defined in workflow)

Replicate locally with `make lint`, `make test`, and for web `cd web && npm ci && npm run lint && npm run build`.

## Conventions

- **Commits**: `type(scope): description` — e.g. `feat(backend): add zone filter`, `fix(web): CSV import`. Types: feat, fix, docs, style, refactor, test, chore.
- **Code style**: Follow project rules in `.cursor/rules/` — Go/agent: [go-backend.mdc](.cursor/rules/go-backend.mdc), Android/mobile: [android.mdc](.cursor/rules/android.mdc), Web: [web-react.mdc](.cursor/rules/web-react.mdc). See also [CONTRIBUTING.md](CONTRIBUTING.md).

Trust these instructions; search the repository only when something here is missing or outdated.
