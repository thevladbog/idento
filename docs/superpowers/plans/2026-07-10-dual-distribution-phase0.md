# Dual Distribution Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four correctness defects (broken subscription onboarding, hand-rolled tenant isolation, subscription upsert 404, wrong tenant source in user authz) and build the packaging foundation (config package, embedded migrations, Docker, version surface, release pipeline) shared by the SaaS and on-prem editions.

**Architecture:** One Go backend (`idento/backend`, Echo + pgx), application-level tenant scoping moved from per-handler comparisons into store-layer `...ForTenant` methods behind the existing `requireEventOwnership` helper pattern. New `internal/config` package is the single reader of environment variables and introduces `DEPLOYMENT_MODE` (used for routing in Phase 1). Migrations become `go:embed`ded so the binary is self-contained for Docker/on-prem.

**Tech Stack:** Go 1.25+ (toolchain 1.26.5), Echo v4, pgx/v5, golang-jwt/v5, existing `fakeStore` unit-test harness (no DB in tests), Docker multi-stage builds (distroless), GitHub Actions.

## Global Constraints

- Module name is `idento/backend`; all Go commands run from `backend/`: `go test ./...`, `go build .`.
- Lint before every commit: `cd backend && go vet ./...` (CI also runs golangci-lint; do not introduce new lint failures).
- `DEPLOYMENT_MODE` accepts exactly `saas` or `onprem`; empty/unset defaults to `onprem` (spec §2 — safe default outside our infra).
- Cross-tenant access responses are unified to **404 "not found"** (no existence oracle). Existing tests asserting 403 for cross-tenant cases must be updated to 404 in the same task that changes the behavior.
- No new third-party Go dependencies. Test infra is the existing `fakeStore` in `backend/internal/handler/testsupport_test.go` (embeds `store.Store`; unset methods panic).
- Conventional commit messages (`fix:`, `feat:`, `build:`, `ci:`, `test:`, `refactor:`).
- Spec: `docs/superpowers/specs/2026-07-10-saas-onprem-distribution-design.md`. Roadmap: `docs/DUAL_DISTRIBUTION_REWORK.md` (P0.1–P0.7).
- CI mode-matrix from P0.6 is **deferred to Phase 1** (P1.1) — `DEPLOYMENT_MODE` exists after this phase but does not affect routing yet, so a matrix would test nothing. This is a deliberate scope cut, not an omission.

## File Structure

```
backend/
├── internal/config/config.go            (new)  — env loading + validation, DeploymentMode
├── internal/config/config_test.go       (new)
├── migrations/embed.go                  (new)  — go:embed of *.up.sql
├── internal/store/pg_store.go           (mod)  — RunMigrations from embed.FS; CreateTenantWithDefaultSubscription; ForTenant getters
├── internal/store/interface.go          (mod)  — 3 new methods
├── internal/store/embed_test.go         (new)
├── internal/handler/auth.go             (mod)  — Register uses CreateTenantWithDefaultSubscription; JWT secret via config
├── internal/handler/auth_register_test.go (new)
├── internal/handler/authz.go            (mod)  — requireEventOwnership via ForTenant; new requireAttendeeOwnership
├── internal/handler/events.go           (mod)  — GetEvent/UpdateEvent via requireEventOwnership (fixes nil-panic)
├── internal/handler/attendees.go        (mod)  — 4 handlers via requireAttendeeOwnership
├── internal/handler/users.go            (mod)  — membership via user_tenants, not users.tenant_id
├── internal/handler/super_admin.go      (mod)  — UpdateTenantSubscription upserts
├── internal/handler/super_admin_subscription_test.go (new)
├── internal/handler/tenant_isolation_test.go (new)
├── internal/handler/testsupport_test.go (mod)  — new fakeStore fields/methods
├── internal/middleware/jwt.go           (mod)  — secret via config
├── cmd/migrate/main.go                  (mod)  — reuse PGStore.RunMigrations
├── migrations/000012_default_plan_backfill.{up,down}.sql (new)
├── Dockerfile                           (new)
├── .dockerignore                        (new)
├── main.go                              (mod)  — config; version var; /api/version, /api/instance
web/
├── Dockerfile                           (new)
├── nginx.conf                           (new)
├── .dockerignore                        (new)
docker-compose.prod.yml                  (new, repo root)
.github/workflows/release.yml            (new)
.env.example                             (mod)
.gitignore                               (mod)
backend/idento-backend                   (DELETE — committed 15 MB binary)
```

---

### Task 1: Config package

**Files:**
- Create: `backend/internal/config/config.go`
- Create: `backend/internal/config/config_test.go`
- Modify: `backend/main.go` (env reads at ~lines 388–435, 481–484)
- Modify: `backend/internal/middleware/jwt.go` (os.Getenv at ~line 30)
- Modify: `backend/internal/handler/auth.go` (os.Getenv in `generateTokenForTenant`, ~line 205)
- Modify: `.env.example`

**Interfaces:**
- Produces: `config.Load() (*config.Config, error)` — reads env, validates, stores package-level current config. `config.Config` fields: `DatabaseURL, JWTSecret string; CORSAllowedOrigins []string; Port string; DeploymentMode string; AdminEmail, AdminPassword string`. `config.JWTSecret() string` — returns loaded config's secret, falling back to `os.Getenv("JWT_SECRET")` when `Load` was not called (keeps existing env-based tests working). Constants `config.ModeSaaS = "saas"`, `config.ModeOnPrem = "onprem"`.
- Consumes: nothing (first task).

- [ ] **Step 1: Write the failing test**

Create `backend/internal/config/config_test.go`:

```go
package config

import "testing"

func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, http://localhost:5174")
}

func TestLoadDefaults(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("PORT", "")
	t.Setenv("DEPLOYMENT_MODE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.Port != "8008" {
		t.Errorf("Port = %q, want 8008", cfg.Port)
	}
	if cfg.DeploymentMode != ModeOnPrem {
		t.Errorf("DeploymentMode = %q, want %q", cfg.DeploymentMode, ModeOnPrem)
	}
	if len(cfg.CORSAllowedOrigins) != 2 || cfg.CORSAllowedOrigins[1] != "http://localhost:5174" {
		t.Errorf("CORSAllowedOrigins = %v, want two trimmed origins", cfg.CORSAllowedOrigins)
	}
}

func TestLoadRejectsMissingRequired(t *testing.T) {
	for _, missing := range []string{"DATABASE_URL", "JWT_SECRET", "CORS_ALLOWED_ORIGINS"} {
		t.Run(missing, func(t *testing.T) {
			setRequiredEnv(t)
			t.Setenv(missing, "")
			if _, err := Load(); err == nil {
				t.Fatalf("Load() succeeded with %s unset, want error", missing)
			}
		})
	}
}

func TestLoadRejectsInvalidMode(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("DEPLOYMENT_MODE", "cloud")
	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded with DEPLOYMENT_MODE=cloud, want error")
	}
}

func TestJWTSecretFallsBackToEnv(t *testing.T) {
	current = nil // package not loaded
	t.Setenv("JWT_SECRET", "env-secret")
	if got := JWTSecret(); got != "env-secret" {
		t.Errorf("JWTSecret() = %q, want env-secret", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/config/ -v`
Expected: FAIL — `no required module provides package` / undefined `Load` (package does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `backend/internal/config/config.go`:

```go
// Package config is the single source of runtime configuration for the
// backend. All environment variables are read here and nowhere else.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Deployment modes. OnPrem is the default: a binary running outside our
// infrastructure must not expose SaaS surfaces unless explicitly configured.
const (
	ModeSaaS   = "saas"
	ModeOnPrem = "onprem"
)

// Config holds validated runtime configuration.
type Config struct {
	DatabaseURL        string
	JWTSecret          string
	CORSAllowedOrigins []string
	Port               string
	DeploymentMode     string
	AdminEmail         string // on-prem bootstrap (used in Phase 2)
	AdminPassword      string // on-prem bootstrap (used in Phase 2)
}

var current *Config

// Load reads and validates configuration from the environment and stores it
// for package-level accessors. Call once at startup, before serving.
func Load() (*Config, error) {
	cfg := &Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		JWTSecret:      os.Getenv("JWT_SECRET"),
		Port:           os.Getenv("PORT"),
		DeploymentMode: os.Getenv("DEPLOYMENT_MODE"),
		AdminEmail:     os.Getenv("IDENTO_ADMIN_EMAIL"),
		AdminPassword:  os.Getenv("IDENTO_ADMIN_PASSWORD"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set (copy .env.example to .env for local development)")
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is not set — refusing to start (set it in .env / environment)")
	}
	for _, o := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			cfg.CORSAllowedOrigins = append(cfg.CORSAllowedOrigins, trimmed)
		}
	}
	if len(cfg.CORSAllowedOrigins) == 0 {
		return nil, fmt.Errorf("CORS_ALLOWED_ORIGINS is not set — refusing to start (see .env.example)")
	}
	if cfg.Port == "" {
		cfg.Port = "8008"
	}
	switch cfg.DeploymentMode {
	case "":
		cfg.DeploymentMode = ModeOnPrem
	case ModeSaaS, ModeOnPrem:
	default:
		return nil, fmt.Errorf("DEPLOYMENT_MODE must be %q or %q, got %q", ModeSaaS, ModeOnPrem, cfg.DeploymentMode)
	}

	current = cfg
	return cfg, nil
}

// JWTSecret returns the loaded JWT secret. Before Load (unit tests that
// exercise handlers directly) it falls back to the environment variable.
func JWTSecret() string {
	if current != nil {
		return current.JWTSecret
	}
	return os.Getenv("JWT_SECRET")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/config/ -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into main.go, jwt.go, auth.go**

In `backend/main.go`, replace the env-reading block inside `main()` (from `if os.Getenv("JWT_SECRET") == ""` through the CORS `log.Fatal`) with:

```go
	// Try .env in cwd first (Docker/packaged runs), then repo root (make dev runs from backend/).
	if err := godotenv.Load(".env"); err != nil {
		if err := godotenv.Load("../.env"); err != nil {
			log.Println("No .env file found, relying on environment variables")
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
```

Then:
- `store.NewPGStore(dbURL)` → `store.NewPGStore(cfg.DatabaseURL)` (delete the `dbURL` block).
- CORS block → `AllowOrigins: cfg.CORSAllowedOrigins` (delete the `corsOrigins` loop and its `log.Fatal`).
- Port block at the bottom → `e.Logger.Fatal(e.Start(":" + cfg.Port))` (delete the `port` variable).
- Add import `"idento/backend/internal/config"`; remove `"strings"` and `"os"` imports if now unused.

In `backend/internal/middleware/jwt.go`, replace the secret lookup inside the keyfunc:

```go
			token, err := jwt.ParseWithClaims(tokenString, &models.JWTCustomClaims{}, func(token *jwt.Token) (interface{}, error) {
				secret := config.JWTSecret()
				if secret == "" {
					return nil, errors.New("JWT_SECRET is not configured")
				}
				return []byte(secret), nil
			})
```

Add import `"idento/backend/internal/config"`, drop `"os"`.

In `backend/internal/handler/auth.go`, in `generateTokenForTenant` replace:

```go
	secret := config.JWTSecret()
	if secret == "" {
		return "", fmt.Errorf("JWT_SECRET environment variable not set")
	}
```

Add import `"idento/backend/internal/config"`; drop `"os"` if now unused in the file.

Append to `.env.example`:

```
# Deployment mode: "saas" (multi-tenant cloud) or "onprem" (single-tenant self-hosted). Default: onprem
DEPLOYMENT_MODE=saas

# On-prem bootstrap admin (used on first start with an empty database; ignored afterwards)
# IDENTO_ADMIN_EMAIL=admin@example.com
# IDENTO_ADMIN_PASSWORD=change-me
```

- [ ] **Step 6: Run full test suite and build**

Run: `cd backend && go build ./... && go test ./... && go vet ./...`
Expected: build OK; all existing tests PASS (middleware/jwt_test.go keeps working via the env fallback in `JWTSecret()`).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/config/ backend/main.go backend/internal/middleware/jwt.go backend/internal/handler/auth.go .env.example
git commit -m "feat(backend): internal/config package with DEPLOYMENT_MODE (P0.3)"
```

---

### Task 2: Embedded migrations + delete committed binary

**Files:**
- Create: `backend/migrations/embed.go`
- Create: `backend/internal/store/embed_test.go`
- Modify: `backend/internal/store/pg_store.go` (`RunMigrations`, lines ~41–144)
- Modify: `backend/cmd/migrate/main.go` (full replacement)
- Modify: `.gitignore`
- Delete: `backend/idento-backend`

**Interfaces:**
- Produces: `migrations.Files embed.FS` (package `idento/backend/migrations`) containing every `*.up.sql`. `PGStore.RunMigrations()` keeps its exact signature and version-tracking behavior, but reads from the embedded FS.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/embed_test.go`:

```go
package store

import (
	"testing"

	"idento/backend/migrations"
)

func TestEmbeddedMigrationsPresent(t *testing.T) {
	entries, err := migrations.Files.ReadDir(".")
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Name()] = true
	}
	for _, want := range []string{"000001_init_schema.up.sql", "000009_super_admin_billing.up.sql", "000011_api_keys_bcrypt.up.sql"} {
		if !found[want] {
			t.Errorf("embedded FS missing %s (got %d entries)", want, len(entries))
		}
	}
	if found["seed.sql"] {
		t.Error("seed.sql must NOT be embedded (glob is *.up.sql)")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store/ -run TestEmbeddedMigrationsPresent -v`
Expected: FAIL — package `idento/backend/migrations` does not exist.

- [ ] **Step 3: Create the embed package**

Create `backend/migrations/embed.go`:

```go
// Package migrations embeds the SQL migration files into the binary so the
// backend is self-contained (no migrations/ directory needed at runtime).
package migrations

import "embed"

// Files contains every up-migration; seed.sql and *.down.sql are intentionally
// excluded — RunMigrations only ever applies up-migrations.
//
//go:embed *.up.sql
var Files embed.FS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/store/ -run TestEmbeddedMigrationsPresent -v`
Expected: PASS.

- [ ] **Step 5: Refactor RunMigrations to use the embedded FS**

In `backend/internal/store/pg_store.go`, replace the body of `RunMigrations` between the `schema_migrations` bootstrap and the `appliedCount := 0` loop header — everything from `// Find migrations directory` through the `defer root.Close()` block — with:

```go
	// Read migration files from the embedded FS (binary is self-contained).
	entries, err := fs.ReadDir(migrations.Files, ".")
	if err != nil {
		return fmt.Errorf("failed to read embedded migrations: %w", err)
	}

	var migrationFiles []string
	for _, entry := range entries {
		migrationFiles = append(migrationFiles, entry.Name())
	}
	sort.Strings(migrationFiles)
```

And in the loop, replace `content, err := root.ReadFile(filename)` with:

```go
		content, err := migrations.Files.ReadFile(filename)
```

Imports: add `"io/fs"` and `"idento/backend/migrations"`; remove `"os"` and `"path/filepath"` if no other function in the file uses them (check with `go build`).

- [ ] **Step 6: Simplify cmd/migrate**

Replace the entire contents of `backend/cmd/migrate/main.go`:

```go
// Command migrate applies pending database migrations and exits.
// Uses the same embedded migrations and version tracking as the server.
package main

import (
	"log"
	"os"

	"idento/backend/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	// cwd differs by invocation: backend/ (go run ./cmd/migrate) or cmd/migrate/ — try each level.
	loaded := false
	for _, p := range []string{".env", "../.env", "../../.env"} {
		if godotenv.Load(p) == nil {
			loaded = true
			break
		}
	}
	if !loaded {
		log.Println("No .env file found, relying on environment variables")
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	pgStore, err := store.NewPGStore(dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pgStore.Close()
	if err := pgStore.RunMigrations(); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}
}
```

(`os.Getenv` here is acceptable: cmd/migrate is a standalone utility needing only DATABASE_URL; using `config.Load()` would force JWT/CORS vars onto a migration-only container.)

- [ ] **Step 7: Delete the committed binary, update .gitignore**

```bash
git rm backend/idento-backend
```

Append to `.gitignore`:

```
backend/idento-backend
backend/idento-backend.exe
```

- [ ] **Step 8: Build, test, verify cwd-independence**

Run: `cd backend && go build ./... && go test ./... && go vet ./...`
Expected: PASS.

Run (requires dev DB up — `make docker-up` if not):
```bash
cd backend && go build -o /tmp/idento-be . && cd /tmp && DATABASE_URL='postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable' JWT_SECRET=x CORS_ALLOWED_ORIGINS=http://localhost:5173 ./idento-be & sleep 3 && curl -s localhost:8008/health && kill %1
```
Expected: log shows `Migrations: no new migrations to apply` (not a "failed to read migrations directory" error); curl prints `{"status":"ok"}`.

- [ ] **Step 9: Commit**

```bash
git add backend/migrations/embed.go backend/internal/store/ backend/cmd/migrate/main.go .gitignore
git commit -m "feat(backend): embed migrations into the binary, drop committed build artifact (P0.4)"
```

---

### Task 3: Default plan + subscription auto-provisioning at registration

**Files:**
- Create: `backend/migrations/000012_default_plan_backfill.up.sql`
- Create: `backend/migrations/000012_default_plan_backfill.down.sql`
- Create: `backend/internal/handler/auth_register_test.go`
- Modify: `backend/internal/store/interface.go` (tenant section, lines 15–17)
- Modify: `backend/internal/store/pg_store.go` (next to `CreateTenant`, line ~148)
- Modify: `backend/internal/handler/auth.go` (`Register`, lines 51–55)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore)

**Interfaces:**
- Consumes: embedded migrations from Task 2 (new file is picked up automatically by the `*.up.sql` glob).
- Produces: `Store.CreateTenantWithDefaultSubscription(ctx context.Context, tenant *models.Tenant) error` — creates the tenant row AND an `active` subscription to the plan marked `is_default`, in one transaction; fills `tenant.ID/CreatedAt/UpdatedAt`. Errors with `"no default subscription plan configured"` if none exists. `subscription_plans.is_default BOOLEAN` column with a single-default unique index.

- [ ] **Step 1: Write the migration**

Create `backend/migrations/000012_default_plan_backfill.up.sql`:

```sql
-- P0.1: default plan flag + subscription backfill.
-- Register() will auto-provision a subscription to the default plan;
-- existing tenants without any subscription get one here (they are currently
-- hard-403'd by the limits middleware: "no active subscription").

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one default plan, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_single_default
    ON subscription_plans ((TRUE)) WHERE is_default;

UPDATE subscription_plans SET is_default = TRUE WHERE slug = 'free';

INSERT INTO subscriptions (tenant_id, plan_id, status, start_date)
SELECT t.id, p.id, 'active', NOW()
FROM tenants t
CROSS JOIN (SELECT id FROM subscription_plans WHERE is_default LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);
```

Create `backend/migrations/000012_default_plan_backfill.down.sql`:

```sql
DROP INDEX IF EXISTS idx_subscription_plans_single_default;
ALTER TABLE subscription_plans DROP COLUMN IF EXISTS is_default;
-- Backfilled subscriptions are intentionally kept: removing them would
-- re-break tenants (limits middleware requires a subscription row).
```

- [ ] **Step 2: Write the failing handler test**

Create `backend/internal/handler/auth_register_test.go`:

```go
package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestRegisterProvisionsDefaultSubscription(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()

	provisioned := false
	fs := &fakeStore{
		createTenantWithDefaultSubscription: func(tenant *models.Tenant) error {
			tenant.ID = uuid.New()
			provisioned = true
			return nil
		},
		getUserByEmail:  func(email string) (*models.User, error) { return nil, nil },
		createUser:      func(u *models.User) error { u.ID = uuid.New(); return nil },
		addUserToTenant: func(ut *models.UserTenant) error { return nil },
		getUserTenants:  func(userID uuid.UUID) ([]*models.Tenant, error) { return nil, nil },
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/auth/register",
		strings.NewReader(`{"tenant_name":"Acme","email":"owner@acme.test","password":"secret123"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := h.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}
	if !provisioned {
		t.Fatal("Register did not call CreateTenantWithDefaultSubscription")
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if resp["token"] == "" {
		t.Error("response has no token")
	}
}
```

Add to the `fakeStore` struct in `backend/internal/handler/testsupport_test.go` (new fields after the existing ones):

```go
	createTenantWithDefaultSubscription func(tenant *models.Tenant) error
	getUserByEmail                      func(email string) (*models.User, error)
	createUser                          func(u *models.User) error
	addUserToTenant                     func(ut *models.UserTenant) error
	getUserTenants                      func(userID uuid.UUID) ([]*models.Tenant, error)
```

And the corresponding methods below the existing ones:

```go
func (f *fakeStore) CreateTenantWithDefaultSubscription(_ context.Context, tenant *models.Tenant) error {
	return f.createTenantWithDefaultSubscription(tenant)
}
func (f *fakeStore) GetUserByEmail(_ context.Context, email string) (*models.User, error) {
	return f.getUserByEmail(email)
}
func (f *fakeStore) CreateUser(_ context.Context, u *models.User) error { return f.createUser(u) }
func (f *fakeStore) AddUserToTenant(_ context.Context, ut *models.UserTenant) error {
	return f.addUserToTenant(ut)
}
func (f *fakeStore) GetUserTenants(_ context.Context, userID uuid.UUID) ([]*models.Tenant, error) {
	return f.getUserTenants(userID)
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run TestRegisterProvisionsDefaultSubscription -v`
Expected: FAIL to compile — `fakeStore` has no method `CreateTenantWithDefaultSubscription` matching the interface... actually the interface method doesn't exist yet, so the compile error is `*fakeStore does not implement store.Store` is NOT triggered (embedding covers it); the real failure: `unknown field createTenantWithDefaultSubscription` is resolved by the testsupport edit, so the test fails at runtime with `panic: ... nil pointer` OR compiles and fails because `Register` never calls the new method. Either failure mode is acceptable evidence.

- [ ] **Step 4: Add the store method**

In `backend/internal/store/interface.go`, after `CreateTenant` (line 15) add:

```go
	// CreateTenantWithDefaultSubscription creates the tenant and an active
	// subscription to the default plan in one transaction (P0.1: a tenant
	// without a subscription is 403-blocked by the limits middleware).
	CreateTenantWithDefaultSubscription(ctx context.Context, tenant *models.Tenant) error
```

In `backend/internal/store/pg_store.go`, after `CreateTenant` (line ~151) add:

```go
func (s *PGStore) CreateTenantWithDefaultSubscription(ctx context.Context, tenant *models.Tenant) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.QueryRow(ctx,
		`INSERT INTO tenants (name) VALUES ($1) RETURNING id, created_at, updated_at`,
		tenant.Name).Scan(&tenant.ID, &tenant.CreatedAt, &tenant.UpdatedAt); err != nil {
		return err
	}

	var planID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM subscription_plans WHERE is_default AND is_active ORDER BY sort_order LIMIT 1`).Scan(&planID); err != nil {
		return fmt.Errorf("no default subscription plan configured: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO subscriptions (tenant_id, plan_id, status, start_date) VALUES ($1, $2, 'active', NOW())`,
		tenant.ID, planID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
```

- [ ] **Step 5: Wire Register**

In `backend/internal/handler/auth.go` `Register`, replace step 1 (lines 51–55):

```go
	// 1. Create Tenant with its default-plan subscription (one transaction).
	tenant := &models.Tenant{Name: req.TenantName}
	if err := h.Store.CreateTenantWithDefaultSubscription(c.Request().Context(), tenant); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create tenant"})
	}
```

- [ ] **Step 6: Run tests**

Run: `cd backend && go build ./... && go test ./... -v -run 'TestRegister|TestEmbedded'`
Then the full suite: `go test ./...`
Expected: PASS.

- [ ] **Step 7: End-to-end verification against the dev DB**

With `make dev` running (or DB up + backend started):

```bash
curl -s -X POST localhost:8008/auth/register -H 'Content-Type: application/json' \
  -d '{"tenant_name":"Smoke Test Org","email":"smoke-p01@test.local","password":"secret123"}' | head -c 200
TOKEN=$(curl -s -X POST localhost:8008/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"smoke-p01@test.local","password":"secret123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST localhost:8008/api/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Event"}' | head -c 200
```

Expected: register returns 201 with token; **create event returns 201** (previously: 403 `"Limit exceeded"` / `no active subscription`). This is the P0.1 acceptance criterion.

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/000012_default_plan_backfill.up.sql backend/migrations/000012_default_plan_backfill.down.sql backend/internal/store/ backend/internal/handler/
git commit -m "fix(backend): auto-provision default-plan subscription at registration + backfill (P0.1)"
```

---

### Task 4: UpdateTenantSubscription upserts instead of 404

**Files:**
- Create: `backend/internal/handler/super_admin_subscription_test.go`
- Modify: `backend/internal/handler/super_admin.go` (`UpdateTenantSubscription`, the `GetSubscriptionByTenantID` block at ~lines 109–116 and the save call further down)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore)

**Interfaces:**
- Consumes: `newAuthedContext(e, method, path, body, tenantID, role)` from testsupport_test.go; `fakeStore` pattern.
- Produces: behavior only — `PATCH /api/super-admin/tenants/:id/subscription` creates the subscription when none exists (requires `plan_id` in that case), updates otherwise. No signature changes.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/handler/super_admin_subscription_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestUpdateTenantSubscriptionCreatesWhenMissing(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	planID := uuid.New()

	var created *models.Subscription
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) { return nil, nil },
		createSubscription: func(sub *models.Subscription) error {
			created = sub
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error {
			return nil
		},
	}
	h := &Handler{Store: fs}

	body := `{"plan_id":"` + planID.String() + `","status":"active"}`
	c, rec := newAuthedContext(e, http.MethodPatch, "/api/super-admin/tenants/"+tenantID.String()+"/subscription", body, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	if created == nil {
		t.Fatal("CreateSubscription was not called for a tenant with no subscription")
	}
	if created.TenantID != tenantID || created.PlanID == nil || *created.PlanID != planID {
		t.Errorf("created subscription = %+v, want tenant %s plan %s", created, tenantID, planID)
	}
}

func TestUpdateTenantSubscriptionRequiresPlanWhenMissing(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) { return nil, nil },
	}
	h := &Handler{Store: fs}

	c, rec := newAuthedContext(e, http.MethodPatch, "/x", `{"status":"active"}`, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (no subscription and no plan_id); body: %s", rec.Code, rec.Body.String())
	}
}
```

Add fakeStore fields:

```go
	getSubscriptionByTenantID func(id uuid.UUID) (*models.Subscription, error)
	createSubscription        func(sub *models.Subscription) error
	updateSubscription        func(sub *models.Subscription) error
	logAdminAction            func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error
```

And methods:

```go
func (f *fakeStore) GetSubscriptionByTenantID(_ context.Context, id uuid.UUID) (*models.Subscription, error) {
	return f.getSubscriptionByTenantID(id)
}
func (f *fakeStore) CreateSubscription(_ context.Context, sub *models.Subscription) error {
	return f.createSubscription(sub)
}
func (f *fakeStore) UpdateSubscription(_ context.Context, sub *models.Subscription) error {
	return f.updateSubscription(sub)
}
func (f *fakeStore) LogAdminAction(_ context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error {
	return f.logAdminAction(adminID, action, targetType, targetID, changes)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run TestUpdateTenantSubscription -v`
Expected: FAIL — first test gets 404 (`"Subscription not found"`), `created == nil`.

- [ ] **Step 3: Implement the upsert**

In `backend/internal/handler/super_admin.go` `UpdateTenantSubscription`, replace:

```go
	// Get existing subscription
	sub, err := h.Store.GetSubscriptionByTenantID(c.Request().Context(), tenantID)
	if err != nil || sub == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Subscription not found",
		})
	}
```

with:

```go
	// Get existing subscription; create one if the tenant has none (upsert).
	sub, err := h.Store.GetSubscriptionByTenantID(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load subscription",
		})
	}
	isNew := false
	if sub == nil {
		if req.PlanID == nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Tenant has no subscription; plan_id is required to create one",
			})
		}
		sub = &models.Subscription{TenantID: tenantID, Status: "active", StartDate: time.Now()}
		isNew = true
	}
```

Further down, where the handler persists via `h.Store.UpdateSubscription(...)`, replace that single call with:

```go
	if isNew {
		if err := h.Store.CreateSubscription(c.Request().Context(), sub); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create subscription"})
		}
	} else {
		if err := h.Store.UpdateSubscription(c.Request().Context(), sub); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update subscription"})
		}
	}
```

(Keep the existing audit `LogAdminAction` call as-is; for `isNew` the captured `oldSub` is the zero value, which renders as "created from nothing" in the audit diff — correct.)

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./internal/handler/ -run TestUpdateTenantSubscription -v && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_subscription_test.go backend/internal/handler/testsupport_test.go
git commit -m "fix(backend): super-admin subscription PATCH upserts when tenant has none (P0.1)"
```

---

### Task 5: Tenant-scoped store methods + authz helpers

**Files:**
- Modify: `backend/internal/store/interface.go` (events section ~line 40, attendees section ~line 46)
- Modify: `backend/internal/store/pg_store.go` (next to `GetEventByID` / `GetAttendeeByID`)
- Modify: `backend/internal/handler/authz.go` (`requireEventOwnership`, lines 45–59; add `requireAttendeeOwnership`)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore)
- Test: `backend/internal/handler/authz_test.go` (existing — update cross-tenant expectations 403→404)

**Interfaces:**
- Produces:
  - `Store.GetEventByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Event, error)` — returns `(nil, nil)` when the event doesn't exist **or belongs to another tenant** (indistinguishable by design).
  - `Store.GetAttendeeByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Attendee, error)` — same contract, scoping via the attendee's event.
  - `(h *Handler) requireAttendeeOwnership(c echo.Context, attendeeID uuid.UUID) (*models.Attendee, error)` — 404 `"Attendee not found"` on missing/foreign, `*httpError` rendered via existing `writeErr`.
  - `requireEventOwnership` keeps its signature but now returns 404 for cross-tenant (was 403).
- Consumes: `tenantIDFromContext`, `newHTTPError`, `writeErr` from `authz.go` (existing).

- [ ] **Step 1: Update fakeStore so the new methods reuse existing fixtures**

In `backend/internal/handler/testsupport_test.go` add methods (no new fields needed — they derive from `getEventByID`/`getAttendeeByID`):

```go
func (f *fakeStore) GetEventByIDForTenant(_ context.Context, id, tenantID uuid.UUID) (*models.Event, error) {
	ev, err := f.getEventByID(id)
	if err != nil || ev == nil {
		return ev, err
	}
	if ev.TenantID != tenantID {
		return nil, nil
	}
	return ev, nil
}

func (f *fakeStore) GetAttendeeByIDForTenant(_ context.Context, id, tenantID uuid.UUID) (*models.Attendee, error) {
	a, err := f.getAttendeeByID(id)
	if err != nil || a == nil {
		return a, err
	}
	ev, err := f.getEventByID(a.EventID)
	if err != nil || ev == nil || ev.TenantID != tenantID {
		return nil, nil
	}
	return a, nil
}
```

- [ ] **Step 2: Add interface methods and PGStore implementations**

In `backend/internal/store/interface.go`, after `GetEventByID` (line 40):

```go
	// GetEventByIDForTenant returns the event only if it belongs to tenantID;
	// (nil, nil) otherwise — callers cannot distinguish "missing" from "foreign".
	GetEventByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Event, error)
```

After `GetAttendeeByID` (line 46):

```go
	// GetAttendeeByIDForTenant scopes the attendee through its event's tenant.
	GetAttendeeByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Attendee, error)
```

In `backend/internal/store/pg_store.go`, after the existing `GetEventByID` implementation:

```go
func (s *PGStore) GetEventByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Event, error) {
	event, err := s.GetEventByID(ctx, id)
	if err != nil || event == nil {
		return event, err
	}
	if event.TenantID != tenantID {
		return nil, nil
	}
	return event, nil
}
```

After the existing `GetAttendeeByID` implementation:

```go
func (s *PGStore) GetAttendeeByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Attendee, error) {
	attendee, err := s.GetAttendeeByID(ctx, id)
	if err != nil || attendee == nil {
		return attendee, err
	}
	event, err := s.GetEventByIDForTenant(ctx, attendee.EventID, tenantID)
	if err != nil {
		return nil, err
	}
	if event == nil {
		return nil, nil
	}
	return attendee, nil
}
```

- [ ] **Step 3: Refactor the authz helpers**

In `backend/internal/handler/authz.go`, replace `requireEventOwnership` (lines 45–59):

```go
// requireEventOwnership loads the event scoped to the caller's tenant.
// Missing and foreign events are both 404 — no existence oracle.
func (h *Handler) requireEventOwnership(c echo.Context, eventID uuid.UUID) (*models.Event, error) {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return nil, err
	}
	event, err := h.Store.GetEventByIDForTenant(c.Request().Context(), eventID, tenantID)
	if err != nil || event == nil {
		return nil, newHTTPError(http.StatusNotFound, "Event not found")
	}
	return event, nil
}

// requireAttendeeOwnership loads the attendee scoped to the caller's tenant
// (via its event). Missing and foreign are both 404.
func (h *Handler) requireAttendeeOwnership(c echo.Context, attendeeID uuid.UUID) (*models.Attendee, error) {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return nil, err
	}
	attendee, err := h.Store.GetAttendeeByIDForTenant(c.Request().Context(), attendeeID, tenantID)
	if err != nil || attendee == nil {
		return nil, newHTTPError(http.StatusNotFound, "Attendee not found")
	}
	return attendee, nil
}
```

- [ ] **Step 4: Run the suite; update cross-tenant expectations to 404**

Run: `cd backend && go build ./... && go test ./internal/handler/ 2>&1 | head -50`
Expected: compile OK; tests that asserted **403** for cross-tenant access through `requireEventOwnership`/`requireZoneOwnership` now FAIL with got-404. Update those assertions (`http.StatusForbidden` → `http.StatusNotFound`) in: `authz_test.go`, `zones_authz_test.go`, `fonts_authz_test.go`, `attendees_authz_test.go`, `api_keys_authz_test.go`, `zones_checkin_authz_test.go` — only in cases that go through the ownership helpers (grep for `StatusForbidden`; leave role-based 403s, e.g. "staff cannot", untouched).

Run again: `cd backend && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/ backend/internal/handler/
git commit -m "refactor(backend): tenant-scoped store getters; unify cross-tenant responses to 404 (P0.2)"
```

---

### Task 6: Migrate events/attendees handlers off hand-rolled tenant checks

**Files:**
- Create: `backend/internal/handler/tenant_isolation_test.go`
- Modify: `backend/internal/handler/events.go` (`GetEvent` lines ~76–94, `UpdateEvent` lines ~105–122)
- Modify: `backend/internal/handler/attendees.go` (`UpdateAttendeeInfo` ~lines 118–142, `UpdateAttendeeHandler` ~lines 268–275 area, `BlockAttendee` ~lines 268–286, `UnblockAttendee` ~lines 300–323, `DeleteAttendee` ~lines 337–360)

**Interfaces:**
- Consumes: `requireEventOwnership`, `requireAttendeeOwnership`, `writeErr` (Task 5); fakeStore ForTenant methods (Task 5).
- Produces: behavior only — no handler contains a raw `TenantID` comparison for events/attendees afterwards.

- [ ] **Step 1: Write the failing isolation tests**

Create `backend/internal/handler/tenant_isolation_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// Table-driven cross-tenant isolation suite (P0.2/P0.6): every handler that
// takes an event or attendee id must 404 when the resource belongs to another
// tenant — indistinguishable from "does not exist".
func TestCrossTenantAccessIs404(t *testing.T) {
	e := echo.New()
	ownerTenant := uuid.New()
	strangerTenant := uuid.New()
	eventID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			if id == eventID {
				return &models.Event{ID: eventID, TenantID: ownerTenant}, nil
			}
			return nil, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			if id == attendeeID {
				return &models.Attendee{ID: attendeeID, EventID: eventID}, nil
			}
			return nil, nil
		},
	}
	h := &Handler{Store: fs}

	cases := []struct {
		name    string
		method  string
		body    string
		param   string
		paramID string
		call    func(c echo.Context) error
	}{
		{"GetEvent", http.MethodGet, "", "id", eventID.String(), h.GetEvent},
		{"UpdateEvent", http.MethodPut, `{"name":"x"}`, "id", eventID.String(), h.UpdateEvent},
		{"UpdateAttendeeInfo", http.MethodPatch, `{"first_name":"x"}`, "id", attendeeID.String(), h.UpdateAttendeeInfo},
		{"BlockAttendee", http.MethodPost, `{"reason":"x"}`, "id", attendeeID.String(), h.BlockAttendee},
		{"UnblockAttendee", http.MethodPost, "", "id", attendeeID.String(), h.UnblockAttendee},
		{"DeleteAttendee", http.MethodDelete, "", "id", attendeeID.String(), h.DeleteAttendee},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := newAuthedContext(e, tc.method, "/x", tc.body, strangerTenant.String(), "admin")
			c.SetParamNames(tc.param)
			c.SetParamValues(tc.paramID)
			if err := tc.call(c); err != nil {
				t.Fatalf("handler error: %v", err)
			}
			if rec.Code != http.StatusNotFound {
				t.Errorf("%s cross-tenant: status = %d, want 404; body: %s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}
}

// GetEvent must not panic for a nonexistent id (pre-P0.2 nil-dereference bug).
func TestGetEventMissingIs404NotPanic(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) { return nil, nil },
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.GetEvent(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify current behavior fails**

Run: `cd backend && go test ./internal/handler/ -run 'TestCrossTenant|TestGetEventMissing' -v`
Expected: FAIL — cross-tenant cases return 403 (and `TestGetEventMissingIs404NotPanic` panics on the nil dereference in `GetEvent`).

- [ ] **Step 3: Refactor events.go**

Replace `GetEvent` entirely:

```go
func (h *Handler) GetEvent(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	event, err := h.requireEventOwnership(c, id)
	if err != nil {
		return writeErr(c, err)
	}
	return c.JSON(http.StatusOK, event)
}
```

In `UpdateEvent`, replace the fetch + security block (from `// Get existing event` through the `Access denied` return):

```go
	event, err := h.requireEventOwnership(c, id)
	if err != nil {
		return writeErr(c, err)
	}
```

(The `Bind` block and field updates below stay unchanged. Remove the now-unused `user := c.Get("user")...` line in both handlers if nothing else references it.)

- [ ] **Step 4: Refactor attendees.go**

In each of `UpdateAttendeeInfo`, `BlockAttendee`, `UnblockAttendee`, `DeleteAttendee`, replace the fetch + security block — from `attendee, err := h.Store.GetAttendeeByID(...)` through the tenant-comparison return (`Access denied`) — with:

```go
	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
	}
```

In `UpdateAttendeeHandler` (check-in), replace its pair of calls (`GetAttendeeByID` + `requireEventOwnership`) with the same two lines, renaming its variable if it uses `existingAttendee`:

```go
	existingAttendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
	}
```

Delete the now-unused `user := c.Get("user").(*models.JWTCustomClaims)` / `tenantID, err := uuid.Parse(user.TenantID)` lines in those handlers (compiler will flag leftovers).

- [ ] **Step 5: Run tests**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS, including the new isolation suite. If `attendees_authz_test.go` has cross-tenant 403 assertions not caught in Task 5, update them to 404 now.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/
git commit -m "refactor(backend): events/attendees handlers use scoped ownership helpers; add isolation suite (P0.2, P0.6)"
```

---

### Task 7: users.go — active tenant from JWT membership, not users.tenant_id

**Files:**
- Modify: `backend/internal/handler/users.go` (`GenerateQRToken` ~lines 119–132, `AssignStaffToEvent` ~lines 186–196)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore: `getUserTenantRole`)
- Test: `backend/internal/handler/users_qrtoken_test.go` (existing — extend)

**Interfaces:**
- Consumes: `Store.GetUserTenantRole(ctx, userID, tenantID uuid.UUID) (string, error)` (already in the interface, `interface.go:30`) — returns the role or an error/empty string when the user is not a member. `requireEventOwnership` from Task 5.
- Produces: behavior only — membership in the **active** tenant (user_tenants) is what authorizes, not the user's home `users.tenant_id`.

- [ ] **Step 1: Add fakeStore support and a failing test**

Add fakeStore field + method:

```go
	getUserTenantRole func(userID, tenantID uuid.UUID) (string, error)
```

```go
func (f *fakeStore) GetUserTenantRole(_ context.Context, userID, tenantID uuid.UUID) (string, error) {
	return f.getUserTenantRole(userID, tenantID)
}
```

Append to `backend/internal/handler/users_qrtoken_test.go`:

```go
func TestGenerateQRTokenUsesActiveTenantMembership(t *testing.T) {
	e := echo.New()
	activeTenant := uuid.New()
	homeTenant := uuid.New() // user's users.tenant_id differs from the active tenant
	targetID := uuid.New()

	saved := false
	fs := &fakeStore{
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: targetID, TenantID: homeTenant, Email: "s@x.y"}, nil
		},
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			if userID == targetID && tenantID == activeTenant {
				return "staff", nil // member of the active tenant via user_tenants
			}
			return "", nil
		},
		updateUserQRToken: func(userID uuid.UUID, token string, _ time.Time) error {
			saved = true
			return nil
		},
	}
	h := &Handler{Store: fs}

	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", activeTenant.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(targetID.String())

	if err := h.GenerateQRToken(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK || !saved {
		t.Fatalf("status = %d, saved = %v; want 200 with token saved (membership via user_tenants must authorize)", rec.Code, saved)
	}
}
```

If `updateUserQRToken` is not yet a fakeStore field, add it:

```go
	updateUserQRToken func(userID uuid.UUID, token string, createdAt time.Time) error
```

```go
func (f *fakeStore) UpdateUserQRToken(_ context.Context, userID uuid.UUID, token string, createdAt time.Time) error {
	return f.updateUserQRToken(userID, token, createdAt)
}
```

(Check the file first — the existing QR-token tests may already define it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run TestGenerateQRTokenUsesActiveTenantMembership -v`
Expected: FAIL — handler returns 403 (compares `targetUser.TenantID != currentTenantID` — home tenant vs active tenant).

- [ ] **Step 3: Fix GenerateQRToken**

In `backend/internal/handler/users.go`, replace the "Verify same tenant" block (~lines 125–132):

```go
	// Verify the target user is a member of the caller's ACTIVE tenant
	// (user_tenants), not their home tenant — users can belong to many orgs.
	currentTenantID, err := uuid.Parse(currentUser.TenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid tenant ID")
	}
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), targetUser.ID, currentTenantID)
	if err != nil || role == "" {
		return echo.NewHTTPError(http.StatusForbidden, "Access denied")
	}
```

- [ ] **Step 4: Fix AssignStaffToEvent**

In the same file (~lines 186–196), replace the event check with the scoped helper and the user check with membership:

```go
	// Verify event belongs to the active tenant (scoped lookup, 404 on foreign).
	if _, err := h.requireEventOwnership(c, eventUUID); err != nil {
		return writeErr(c, err)
	}

	// Verify the target user is a member of the active tenant.
	targetUser, err := h.Store.GetUserByID(c.Request().Context(), userUUID)
	if err != nil || targetUser == nil {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), targetUser.ID, tenantID)
	if err != nil || role == "" {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}
```

(`tenantID` is already parsed at the top of this handler; the `event` variable was only used for the check — delete the unused binding.)

- [ ] **Step 5: Run tests**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS. If existing QR-token tests relied on home-tenant matching, update their fakeStore with a `getUserTenantRole` that mirrors the old fixture's intent (member → role, non-member → "").

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/users.go backend/internal/handler/users_qrtoken_test.go backend/internal/handler/testsupport_test.go
git commit -m "fix(backend): authorize QR-token and staff-assign via active-tenant membership (P0.2)"
```

---

### Task 8: Dockerfiles + production compose

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Create: `web/Dockerfile`
- Create: `web/nginx.conf`
- Create: `web/.dockerignore`
- Create: `docker-compose.prod.yml` (repo root)

**Interfaces:**
- Consumes: self-contained backend binary (embedded migrations, Task 2); config env vars (Task 1).
- Produces: images `idento-backend` (distroless, port 8008, `ARG VERSION` → `main.version` ldflag — consumed by Task 9) and `idento-web` (nginx, port 80, `ARG VITE_API_URL` baked at build). Compose file consumed by Phase 2's on-prem bundle.

- [ ] **Step 1: backend/Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/idento-backend .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/idento-backend /app/idento-backend
COPY --from=build /src/templates /app/templates
EXPOSE 8008
ENTRYPOINT ["/app/idento-backend"]
```

`backend/.dockerignore`:

```
idento-backend
idento-backend.exe
*.md
coverage*
```

Note: `templates/` is copied because `main.go` serves `templates/printer_qr_generator.html` from the working directory. Verify the directory exists at `backend/templates/`; if it is elsewhere, adjust the COPY path — do not skip it.

- [ ] **Step 2: Build to verify**

Run: `cd backend && docker build -t idento-backend:dev .`
Expected: image builds. (`-X main.version` targets the variable added in Task 9; before that the Go linker silently ignores the missing symbol — the build does not fail.)

Run: `docker run --rm -e JWT_SECRET=x -e CORS_ALLOWED_ORIGINS=http://localhost -e DATABASE_URL=postgres://nouser@nohost/nodb idento-backend:dev; echo "exit=$?"`
Expected: exits non-zero with `Unable to connect to database` — proves config loads and binary runs in distroless (no missing migrations dir).

- [ ] **Step 3: web/Dockerfile + nginx.conf**

`web/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`web/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Immutable hashed assets
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }
}
```

`web/.dockerignore`:

```
node_modules
dist
```

Run: `cd web && docker build --build-arg VITE_API_URL=http://localhost:8008 -t idento-web:dev .`
Expected: image builds.

- [ ] **Step 4: docker-compose.prod.yml**

Create at repo root:

```yaml
# Production compose: backend + web + postgres.
# Copy .env.example to .env and set JWT_SECRET, POSTGRES_PASSWORD,
# CORS_ALLOWED_ORIGINS, PUBLIC_API_URL before `docker compose -f docker-compose.prod.yml up -d`.
services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-idento}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ${POSTGRES_DB:-idento_db}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-idento} -d ${POSTGRES_DB:-idento_db}"]
      interval: 5s
      timeout: 3s
      retries: 12

  backend:
    build: ./backend
    restart: always
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-idento}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-idento_db}?sslmode=disable
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:?set CORS_ALLOWED_ORIGINS in .env}
      DEPLOYMENT_MODE: ${DEPLOYMENT_MODE:-onprem}
    ports:
      - "8008:8008"
    depends_on:
      db:
        condition: service_healthy

  web:
    build:
      context: ./web
      args:
        VITE_API_URL: ${PUBLIC_API_URL:?set PUBLIC_API_URL in .env (e.g. http://your-host:8008)}
    restart: always
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  postgres_data:
```

- [ ] **Step 5: Verify the full stack from clean state**

```bash
cd /Users/thevladbog/PRSOME/idento
cat > /tmp/idento-prod-test.env <<'EOF'
POSTGRES_PASSWORD=prodtest
JWT_SECRET=prodtest-secret
CORS_ALLOWED_ORIGINS=http://localhost
PUBLIC_API_URL=http://localhost:8008
EOF
docker compose -f docker-compose.prod.yml --env-file /tmp/idento-prod-test.env up -d --build
sleep 10
curl -s localhost:8008/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:80/
docker compose -f docker-compose.prod.yml --env-file /tmp/idento-prod-test.env down -v
```

Expected: `{"status":"ok"}` and `200`. (Uses port 5432 internally only — no clash with the dev compose on 5438.)

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore web/Dockerfile web/nginx.conf web/.dockerignore docker-compose.prod.yml
git commit -m "build: backend/web Dockerfiles and production docker-compose (P0.5)"
```

---

### Task 9: Version and instance endpoints

**Files:**
- Modify: `backend/main.go` (top-level var; routes near the `/health` handler, ~line 448)

**Interfaces:**
- Consumes: `cfg` from Task 1 (in scope inside `main()`); `ARG VERSION` ldflag from Task 8.
- Produces: `GET /api/version` → `{"version": "<v>"}`; `GET /api/instance` → `{"mode": "saas"|"onprem", "version": "<v>", "license": null}`. Both unauthenticated (web must read the mode before login). Phase 1 (P1.1) and Phase 2 (P2.2) consume `/api/instance`.

- [ ] **Step 1: Add the version variable**

In `backend/main.go`, after the imports (top level):

```go
// version is the build version, injected at build time via
// -ldflags "-X main.version=v1.2.3". "dev" for local builds.
var version = "dev"
```

- [ ] **Step 2: Add the routes**

Next to the `/health` route inside `main()`:

```go
	// Version / instance metadata (public: web reads the mode before login).
	e.GET("/api/version", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"version": version})
	})
	e.GET("/api/instance", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"mode":    cfg.DeploymentMode,
			"version": version,
			"license": nil,
		})
	})
```

(These are registered on `e` directly, not on the `api` group, so the JWT middleware does not apply despite the `/api` prefix.)

- [ ] **Step 3: Verify**

Run: `cd backend && go build ./... && go test ./...` — PASS.

With the dev stack up:

```bash
curl -s localhost:8008/api/version
curl -s localhost:8008/api/instance
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer garbage' localhost:8008/api/instance
```

Expected: `{"version":"dev"}`; `{"license":null,"mode":"onprem","version":"dev"}` (or `saas` if set in your .env); final call still `200` (no auth applied).

- [ ] **Step 4: Commit**

```bash
git add backend/main.go
git commit -m "feat(backend): /api/version and /api/instance endpoints (P0.7)"
```

---

### Task 10: Release workflow (tags → GHCR image + binaries)

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `backend/Dockerfile` with `ARG VERSION` (Task 8), `main.version` ldflag target (Task 9).
- Produces: on tag `v*`: `ghcr.io/<owner>/<repo>-backend:{<tag>,latest}` multi-arch image; GitHub Release with `idento-backend_linux_{amd64,arm64}` binaries. The on-prem bundle (Phase 2, P2.3) attaches to this same release flow later.
- Deliberate scope cut: no GHCR **web** image — `VITE_API_URL` is baked at build time, so a generic prebuilt web image would point at the wrong API; customers build web via compose (Task 8). Revisit if/when the web app reads its API URL at runtime.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write
  packages: write

jobs:
  backend-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: ./backend
          platforms: linux/amd64,linux/arm64
          push: true
          build-args: |
            VERSION=${{ github.ref_name }}
          tags: |
            ghcr.io/${{ github.repository }}-backend:${{ github.ref_name }}
            ghcr.io/${{ github.repository }}-backend:latest

  binaries:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        goarch: [amd64, arm64]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: backend/go.mod
      - name: Build
        working-directory: backend
        env:
          CGO_ENABLED: "0"
          GOOS: linux
          GOARCH: ${{ matrix.goarch }}
        run: |
          go build -trimpath \
            -ldflags "-s -w -X main.version=${{ github.ref_name }}" \
            -o "idento-backend_linux_${{ matrix.goarch }}" .
      - uses: actions/upload-artifact@v4
        with:
          name: idento-backend_linux_${{ matrix.goarch }}
          path: backend/idento-backend_linux_${{ matrix.goarch }}

  release:
    needs: [backend-image, binaries]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: dist
          merge-multiple: true
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/*
          generate_release_notes: true
```

- [ ] **Step 2: Validate the workflow file**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"`
Expected: `yaml ok`. (Full validation happens on the first tag push — releasing is a user decision, not part of this plan.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered release workflow — GHCR backend image + linux binaries (P0.7)"
```

---

## Final Verification (whole phase)

- [ ] `cd backend && go build ./... && go test ./... && go vet ./...` — all green.
- [ ] Smoke flow from Task 3 Step 7 (register → login → create event) — 201.
- [ ] Compose stack from Task 8 Step 5 — health + web 200.
- [ ] `git log --oneline` shows ~10 conventional commits mapping to P0.1–P0.7.
- [ ] Acceptance criteria in `docs/DUAL_DISTRIBUTION_REWORK.md` §Phase 0: every P0 item's "Accept" line is satisfied (re-read them one by one).
