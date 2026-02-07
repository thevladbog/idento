---
applyTo: "agent/**"
---

# Printing Agent (Go)

- Local agent for printers and barcode/QR scanners; HTTP API, see `agent/openapi.yaml`
- Packages: `internal/printer/`, `internal/scanner/`; main entry in `main.go`
- Same Go style as backend: Clean Architecture, explicit errors, interfaces
- Lint: `make lint` (runs for both backend and agent) or from agent/ run golangci-lint
- Test: `cd agent && go test ./...`
- Follow `.cursor/rules/go-backend.mdc` (shared with backend)
