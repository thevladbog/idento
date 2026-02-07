---
applyTo: "backend/**"
---

# Backend (Go)

- Echo framework; handlers in `internal/handler/`, store in `internal/store/`, models in `internal/models/`
- Use Clean Architecture: handlers → store (interfaces) → PostgreSQL
- Migrations in `backend/migrations/`; OpenAPI in `backend/openapi.yaml`
- Lint: `make lint` (golangci-lint) or `golangci-lint run ./internal/...` from backend/
- Test: `cd backend && go test ./...`; handle errors explicitly, use table-driven tests where appropriate
- Follow `.cursor/rules/go-backend.mdc` for style and patterns
