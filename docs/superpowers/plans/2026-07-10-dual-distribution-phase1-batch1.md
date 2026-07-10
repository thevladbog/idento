# Dual Distribution Phase 1 — Batch 1 (Editions Core + Review Debts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `DEPLOYMENT_MODE` real (route mounting + mode-aware seeding), enforce tenant lifecycle/suspension at runtime, fix the attendee limit, and clear the Phase 0 review debts (isolation sweep, transactional registration, upsert race) — roadmap items P1.1–P1.4, P1.9–P1.10.

**Architecture:** All backend (Go/Echo/pgx, module `idento/backend`) plus one small web change. Mode flows `config.Load()` → `main` → `RegisterRoutes(e, mode)` for mounting and → `EnsureSeedData(ctx, mode)` for seeds. Tenant lifecycle is a `tenants.status` column enforced by a new cached `TenantGate` middleware on the `/api` group. Isolation debts reuse the Phase 0 ownership helpers verbatim.

**Tech Stack:** Go 1.25+ (toolchain 1.26.5), Echo v4, pgx/v5, existing `fakeStore` handler-test harness, React/axios/i18next (one web file pair).

## Global Constraints

- Module `idento/backend`; Go commands from `backend/`: `go build ./... && go test ./... && go vet ./...` plus `golangci-lint run ./internal/...` and `gofmt -l .` (empty) before every commit.
- `DEPLOYMENT_MODE` values: exactly `config.ModeSaaS` ("saas") / `config.ModeOnPrem` ("onprem"); unset defaults to onprem (already enforced by `config.Load`).
- In `onprem` mode `POST /auth/register` and everything under `/api/super-admin` are **not mounted** (plain 404). Migration chain must stay identical in both modes; seeds live in startup code only.
- Blocked-tenant responses: HTTP 403 with machine-readable body `{"code": "tenant_suspended"}` — one code for suspended/archived/expired (clients show one state). Exempt paths: `GET /api/me` and `/api/super-admin/*`.
- Tenant lifecycle states: exactly `active`, `suspended`, `archived`. Transitions: suspend only from active; reactivate only from suspended; archive only from suspended. Invalid transition → 409.
- Cross-tenant/missing resources: uniform **404**; store errors: **500** (never masked as 404) — same contract as Phase 0.
- No new third-party dependencies (Go or npm).
- Roadmap acceptance criteria: `docs/DUAL_DISTRIBUTION_REWORK.md` §Phase 1 items P1.1, P1.2, P1.3, P1.4, P1.9, P1.10 (in main).
- Scope cut (decided): P1.2 client handling ships for **web only** in this batch; mobile/kiosk show their generic error until a follow-up task — record this in the PR description.
- E2E verifications use a self-started docker dev DB (`docker compose up -d db`, port 5438) exactly like Phase 0; teardown `docker compose down -v`.

## File Structure

```
backend/
├── internal/handler/handler.go          (mod)  — RegisterRoutes(e, mode); TenantGate wiring; new attendee-limit middleware wiring; lifecycle routes
├── internal/handler/routes_mode_test.go (new)
├── internal/store/seed.go               (new)  — EnsureSeedData(ctx, mode)
├── internal/store/pg_store.go           (mod)  — UpdateTenantStatus/GetTenantStatus; status in tenant SELECTs; CheckAttendeeLimit/CountEventAttendees; ProvisionTenantWithAdmin; UpsertSubscription
├── internal/store/interface.go          (mod)  — new methods
├── internal/middleware/tenant_gate.go   (new)  — cached suspension/expiry gate
├── internal/middleware/tenant_gate_test.go (new)
├── internal/middleware/limits.go        (mod)  — CheckAttendeeLimits (event-scoped)
├── internal/handler/super_admin.go      (mod)  — CreateTenantSuper, SetTenantStatus handlers; UpsertSubscription in PATCH
├── internal/handler/super_admin_lifecycle_test.go (new)
├── internal/handler/auth.go             (mod)  — Register via ProvisionTenantWithAdmin
├── internal/handler/badge_zpl.go        (mod)  — ownership helpers (P1.9)
├── internal/handler/attendee_codes.go   (mod)  — ownership helpers ×2 (P1.9)
├── internal/handler/bulk_import.go      (mod)  — ownership helper + bulk limit check (P1.9, P1.3)
├── internal/handler/zones.go            (mod)  — GetUserZoneAssignments membership authz (P1.9)
├── internal/handler/tenant_isolation_test.go (mod) — new suite cases
├── internal/handler/testsupport_test.go (mod)  — fakeStore additions
├── internal/models/models.go            (mod)  — Tenant.Status
├── migrations/000009_super_admin_billing.up.sql (mod) — seed INSERTs removed
├── migrations/000013_tenant_lifecycle.{up,down}.sql (new)
web/
├── src/lib/api.ts                       (mod)  — tenant_suspended interceptor
├── src/i18n.ts                          (mod)  — tenantSuspended key EN/RU
```

Execution note: at execution start, commit this plan file to the feature branch (`git add docs/superpowers/plans/2026-07-10-dual-distribution-phase1-batch1.md && git commit -m "docs: phase 1 batch 1 plan"`), matching how prior phase plans live in main.

---

### Task 1: Mode-aware route mounting (P1.1a)

**Files:**
- Modify: `backend/internal/handler/handler.go:27-42` (signature + auth group), `:136-157` (super-admin group)
- Modify: `backend/main.go` (the `h.RegisterRoutes(e)` call)
- Test: `backend/internal/handler/routes_mode_test.go` (new)

**Interfaces:**
- Consumes: `config.ModeSaaS` / `config.ModeOnPrem` constants (`backend/internal/config/config.go`, Phase 0).
- Produces: `func (h *Handler) RegisterRoutes(e *echo.Echo, mode string)` — every later task and `main.go` use this two-arg signature. In onprem: `/auth/register` and the whole `/api/super-admin` group are not registered.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/handler/routes_mode_test.go`:

```go
package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/config"

	"github.com/labstack/echo/v4"
)

func routeStatus(t *testing.T, mode, method, path, body string) int {
	t.Helper()
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	h.RegisterRoutes(e, mode)
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

func TestOnPremDoesNotMountSaaSRoutes(t *testing.T) {
	if got := routeStatus(t, config.ModeOnPrem, http.MethodPost, "/auth/register", `{}`); got != http.StatusNotFound {
		t.Errorf("onprem /auth/register = %d, want 404 (route must not exist)", got)
	}
	if got := routeStatus(t, config.ModeOnPrem, http.MethodGet, "/api/super-admin/plans", ""); got != http.StatusNotFound {
		t.Errorf("onprem /api/super-admin/plans = %d, want 404 (group must not exist)", got)
	}
}

func TestSaaSMountsRegisterAndSuperAdmin(t *testing.T) {
	// Bad body → 400 proves the route exists (404 would mean unmounted).
	if got := routeStatus(t, config.ModeSaaS, http.MethodPost, "/auth/register", `{}`); got == http.StatusNotFound {
		t.Error("saas /auth/register returned 404 — route not mounted")
	}
	// No bearer token → 401 from JWT middleware proves the group exists.
	if got := routeStatus(t, config.ModeSaaS, http.MethodGet, "/api/super-admin/plans", ""); got != http.StatusUnauthorized {
		t.Errorf("saas /api/super-admin/plans = %d, want 401 (mounted, behind JWT)", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run 'TestOnPrem|TestSaaSMounts' -v`
Expected: FAIL to compile — `too many arguments in call to h.RegisterRoutes`.

- [ ] **Step 3: Implement**

In `backend/internal/handler/handler.go`:

```go
// RegisterRoutes mounts all API routes on the given Echo instance.
// mode is config.ModeSaaS or config.ModeOnPrem: in onprem, open registration
// and the platform super-admin surface are not mounted at all (404).
func (h *Handler) RegisterRoutes(e *echo.Echo, mode string) {
```

Wrap the register route (keep login/login-qr unconditional):

```go
	// Auth routes
	auth := e.Group("/auth")
	if mode == config.ModeSaaS {
		auth.POST("/register", h.Register) // self-serve signup is SaaS-only
	}
	auth.POST("/login", h.Login, authLimiter)
	auth.POST("/login-qr", h.LoginWithQR, authLimiter)
```

Wrap the entire super-admin block (from `superAdmin := api.Group("/super-admin")` through the last `superAdmin.GET("/audit-log", ...)`):

```go
	// Super Admin routes (platform console) — SaaS-only surface
	if mode == config.ModeSaaS {
		superAdmin := api.Group("/super-admin")
		superAdmin.Use(middleware.SuperAdminOnly(h.Store))
		... // existing registrations, unchanged, indented into this block
	}
```

Add import `"idento/backend/internal/config"`.

In `backend/main.go` replace `h.RegisterRoutes(e)` with:

```go
	h.RegisterRoutes(e, cfg.DeploymentMode)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go build ./... && go test ./internal/handler/ -run 'TestOnPrem|TestSaaSMounts' -v && go test ./...`
Expected: PASS (new tests + full suite).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/handler.go backend/internal/handler/routes_mode_test.go backend/main.go
git commit -m "feat(backend): mount register/super-admin routes only in saas mode (P1.1)"
```

---

### Task 2: Plan seeds out of migrations → mode-aware startup seeding (P1.1b)

**Files:**
- Modify: `backend/migrations/000009_super_admin_billing.up.sql` (delete the two INSERT blocks at the tail: "Базовые тарифные планы" and "Создаем Free подписки")
- Create: `backend/internal/store/seed.go`
- Modify: `backend/internal/store/interface.go` (add method), `backend/main.go` (call after RunMigrations)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore no-op not needed — handler tests never call it; skip)

**Interfaces:**
- Consumes: `config.ModeSaaS`/`ModeOnPrem`.
- Produces: `Store.EnsureSeedData(ctx context.Context, mode string) error` — idempotent; saas seeds the four public tiers and defaults `free`; onprem seeds a single hidden `unlimited` plan and defaults it. Registration/bootstrap rely on exactly one `is_default AND is_active` plan existing after startup.

- [ ] **Step 1: Strip seeds from migration 000009**

Delete from `backend/migrations/000009_super_admin_billing.up.sql` everything from the line `-- Базовые тарифные планы` to the end of the file (both INSERT statements). Schema (tables, indexes) stays. Existing databases already recorded version 000009 and never re-run it; fresh databases get schema-only, then startup seeding below. Migration 000012's `UPDATE ... WHERE slug = 'free'` and backfill become no-ops on fresh DBs — correct (no tenants exist there either).

- [ ] **Step 2: Create the seeder**

Create `backend/internal/store/seed.go`:

```go
package store

import (
	"context"
	"fmt"

	"idento/backend/internal/config"
)

// saasPlanSeeds mirrors the tiers previously seeded by migration 000009.
const saasPlanSeeds = `
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features, sort_order) VALUES
('Free', 'free', 'free', 'For small events and testing', 0, 0,
 '{"events_per_month": 2, "attendees_per_event": 50, "users": 2, "storage_mb": 100}',
 '{"custom_branding": false, "api_access": false, "priority_support": false}', 1),
('Starter', 'starter', 'starter', 'For growing organizations', 29, 290,
 '{"events_per_month": 10, "attendees_per_event": 500, "users": 5, "storage_mb": 1000}',
 '{"custom_branding": true, "api_access": false, "priority_support": false}', 2),
('Professional', 'pro', 'pro', 'For professional event organizers', 99, 990,
 '{"events_per_month": -1, "attendees_per_event": 5000, "users": 20, "storage_mb": 10000}',
 '{"custom_branding": true, "api_access": true, "priority_support": true}', 3),
('Enterprise', 'enterprise', 'enterprise', 'Custom solution for large organizations', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": true, "dedicated_support": true}', 4)
ON CONFLICT (slug) DO NOTHING`

// onPremPlanSeeds: one hidden, unlimited plan — self-hosted installs are not metered.
const onPremPlanSeeds = `
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features, is_public, sort_order) VALUES
('Unlimited', 'unlimited', 'custom', 'Self-hosted unlimited plan', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": false}', FALSE, 0)
ON CONFLICT (slug) DO NOTHING`

// EnsureSeedData inserts the mode's subscription plans if missing and
// guarantees exactly one default plan. Idempotent; runs on every startup
// after migrations (seeds deliberately live outside the migration chain so
// the chain is identical in both deployment modes).
func (s *PGStore) EnsureSeedData(ctx context.Context, mode string) error {
	seeds, defaultSlug := saasPlanSeeds, "free"
	if mode == config.ModeOnPrem {
		seeds, defaultSlug = onPremPlanSeeds, "unlimited"
	}
	if _, err := s.db.Exec(ctx, seeds); err != nil {
		return fmt.Errorf("seed subscription plans: %w", err)
	}
	// Single-default invariant is enforced by the partial unique index from
	// migration 000012; only set a default when none exists yet.
	if _, err := s.db.Exec(ctx, `
		UPDATE subscription_plans SET is_default = TRUE
		WHERE slug = $1
		  AND NOT EXISTS (SELECT 1 FROM subscription_plans WHERE is_default)`,
		defaultSlug); err != nil {
		return fmt.Errorf("ensure default plan: %w", err)
	}
	return nil
}
```

- [ ] **Step 3: Interface + main wiring**

In `backend/internal/store/interface.go`, after `CreateTenantWithDefaultSubscription`:

```go
	// EnsureSeedData seeds mode-appropriate subscription plans (idempotent).
	EnsureSeedData(ctx context.Context, mode string) error
```

In `backend/main.go`, right after the `RunMigrations` block:

```go
	if err := pgStore.EnsureSeedData(context.Background(), cfg.DeploymentMode); err != nil {
		log.Fatalf("Seed data failed: %v", err)
	}
```

(add `"context"` import if missing).

- [ ] **Step 4: Build + full suite**

Run: `cd backend && go build ./... && go test ./... && go vet ./...`
Expected: PASS. (No isolated unit test — seeding is SQL against a live schema; it is exercised end-to-end in Step 5 and in the Final Verification.)

- [ ] **Step 5: E2E — fresh DB seeds and registers (saas)**

```bash
cd "$(git rev-parse --show-toplevel)"
docker compose up -d db && until docker exec idento_db pg_isready -U idento -d idento_db >/dev/null 2>&1; do sleep 1; done
cd backend && go build -o /tmp/idento-p1 . && DATABASE_URL='postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable' JWT_SECRET=smoke CORS_ALLOWED_ORIGINS=http://localhost:5173 DEPLOYMENT_MODE=saas /tmp/idento-p1 & sleep 3
curl -s -X POST localhost:8008/auth/register -H 'Content-Type: application/json' -d '{"tenant_name":"Seed Test","email":"seed-p1@test.local","password":"secret123"}' | head -c 120; echo
docker exec idento_db psql -U idento -d idento_db -tc "SELECT slug, is_default FROM subscription_plans ORDER BY sort_order"
kill %1; cd .. && docker compose down -v
```

Expected: register returns 201 (token in body); psql shows 4 rows with `free | t`.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/000009_super_admin_billing.up.sql backend/internal/store/seed.go backend/internal/store/interface.go backend/main.go
git commit -m "feat(backend): mode-aware startup plan seeding; strip seeds from migration 000009 (P1.1)"
```

---

### Task 3: Tenant lifecycle column + store methods (P1.4 schema)

**Files:**
- Create: `backend/migrations/000013_tenant_lifecycle.up.sql`, `backend/migrations/000013_tenant_lifecycle.down.sql`
- Modify: `backend/internal/models/models.go` (Tenant struct, line ~9)
- Modify: `backend/internal/store/pg_store.go` (`GetTenantByID` SELECT; new methods next to it)
- Modify: `backend/internal/store/interface.go` (tenant section)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore fields)

**Interfaces:**
- Produces:
  - `tenants.status VARCHAR(20) NOT NULL DEFAULT 'active'` + CHECK constraint.
  - `models.Tenant.Status string` (json `status`).
  - `Store.GetTenantStatus(ctx context.Context, id uuid.UUID) (string, error)` — `("", pgx→nil-normalized error?)` no: returns `("", nil)` when the tenant does not exist (missing tenant is treated as blocked by the gate).
  - `Store.UpdateTenantStatus(ctx context.Context, id uuid.UUID, status string) error` — no transition logic here (handlers own transitions).
- Consumes: nothing new.

- [ ] **Step 1: Migration**

`backend/migrations/000013_tenant_lifecycle.up.sql`:

```sql
-- P1.4: tenant lifecycle. Suspension/archival are enforced on the request
-- path by the TenantGate middleware; subscription.status stays billing-only.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_status CHECK (status IN ('active', 'suspended', 'archived'));
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status) WHERE status <> 'active';
```

`backend/migrations/000013_tenant_lifecycle.down.sql`:

```sql
DROP INDEX IF EXISTS idx_tenants_status;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_status;
ALTER TABLE tenants DROP COLUMN IF EXISTS status;
```

- [ ] **Step 2: Model + store**

`models.Tenant` gains (after `Name`):

```go
	Status       string                 `json:"status"`
```

In `backend/internal/store/pg_store.go`:
- `GetTenantByID`: add `status` to the SELECT column list and `&t.Status` to the Scan (keep column order aligned).
- Add next to `UpdateTenant`:

```go
// GetTenantStatus returns the lifecycle status, or "" if the tenant does not exist.
func (s *PGStore) GetTenantStatus(ctx context.Context, id uuid.UUID) (string, error) {
	var status string
	err := s.db.QueryRow(ctx, `SELECT status FROM tenants WHERE id = $1`, id).Scan(&status)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return status, nil
}

// UpdateTenantStatus sets the lifecycle status; transition rules live in the handler.
func (s *PGStore) UpdateTenantStatus(ctx context.Context, id uuid.UUID, status string) error {
	tag, err := s.db.Exec(ctx, `UPDATE tenants SET status = $2, updated_at = NOW() WHERE id = $1`, id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tenant %s not found", id)
	}
	return nil
}
```

Interface additions (tenant section):

```go
	GetTenantStatus(ctx context.Context, id uuid.UUID) (string, error)
	UpdateTenantStatus(ctx context.Context, id uuid.UUID, status string) error
```

fakeStore additions (`backend/internal/handler/testsupport_test.go`):

```go
	getTenantStatus    func(id uuid.UUID) (string, error)
	updateTenantStatus func(id uuid.UUID, status string) error
```

```go
func (f *fakeStore) GetTenantStatus(_ context.Context, id uuid.UUID) (string, error) {
	return f.getTenantStatus(id)
}
func (f *fakeStore) UpdateTenantStatus(_ context.Context, id uuid.UUID, status string) error {
	return f.updateTenantStatus(id, status)
}
```

- [ ] **Step 3: Build + suite + commit**

Run: `cd backend && go build ./... && go test ./... && go vet ./...` — PASS.

```bash
git add backend/migrations/000013_tenant_lifecycle.up.sql backend/migrations/000013_tenant_lifecycle.down.sql backend/internal/models/models.go backend/internal/store/ backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): tenants.status lifecycle column + store accessors (P1.4)"
```

---

### Task 4: Lifecycle endpoints for operators (P1.4 handlers)

**Files:**
- Modify: `backend/internal/handler/super_admin.go` (new handlers at the end)
- Modify: `backend/internal/handler/handler.go` (super-admin group — inside the Task 1 saas block)
- Test: `backend/internal/handler/super_admin_lifecycle_test.go` (new)

**Interfaces:**
- Consumes: `Store.GetTenantStatus`/`UpdateTenantStatus` (Task 3), `Store.CreateTenantWithDefaultSubscription` (Phase 0), `Store.LogAdminAction`, `newAuthedContext` test helper.
- Produces routes (all inside the super-admin group):
  - `POST /api/super-admin/tenants` body `{"name": "..."}` → 201 with the tenant (subscription auto-provisioned).
  - `POST /api/super-admin/tenants/:id/suspend` | `/reactivate` | `/archive` → 200 `{"status": "<new>"}`; 409 `{"error": ...}` on invalid transition; audit actions `create_tenant`, `suspend_tenant`, `reactivate_tenant`, `archive_tenant`.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/handler/super_admin_lifecycle_test.go`:

```go
package handler

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func lifecycleCtx(t *testing.T, fs *fakeStore, target uuid.UUID, action string) (*Handler, echo.Context, func() int) {
	t.Helper()
	e := echo.New()
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(target.String())
	_ = action
	return h, c, func() int { return rec.Code }
}

func TestSuspendTenantFromActive(t *testing.T) {
	target := uuid.New()
	var saved string
	fs := &fakeStore{
		getTenantStatus:    func(id uuid.UUID) (string, error) { return "active", nil },
		updateTenantStatus: func(id uuid.UUID, s string) error { saved = s; return nil },
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error {
			return nil
		},
	}
	h, c, code := lifecycleCtx(t, fs, target, "suspend")
	if err := h.SuspendTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if code() != http.StatusOK || saved != "suspended" {
		t.Fatalf("status=%d saved=%q; want 200/suspended", code(), saved)
	}
}

func TestArchiveRequiresSuspended(t *testing.T) {
	target := uuid.New()
	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
	}
	h, c, code := lifecycleCtx(t, fs, target, "archive")
	if err := h.ArchiveTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if code() != http.StatusConflict {
		t.Fatalf("status=%d; want 409 (archive only from suspended)", code())
	}
}

func TestCreateTenantSuper(t *testing.T) {
	e := echo.New()
	created := false
	fs := &fakeStore{
		createTenantWithDefaultSubscription: func(tenant *models.Tenant) error {
			tenant.ID = uuid.New()
			created = true
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error {
			return nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"name":"Ops Created Org"}`, uuid.New().String(), "admin")
	if err := h.CreateTenantSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusCreated || !created {
		t.Fatalf("status=%d created=%v; want 201 + store call", rec.Code, created)
	}
}
```

(add `"idento/backend/internal/models"` to imports).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/handler/ -run 'TestSuspendTenant|TestArchiveRequires|TestCreateTenantSuper' -v`
Expected: FAIL to compile — `h.SuspendTenant` / `h.ArchiveTenant` / `h.CreateTenantSuper` undefined.

- [ ] **Step 3: Implement handlers**

Append to `backend/internal/handler/super_admin.go`:

```go
// CreateTenantSuper lets a platform operator provision an organization
// manually (subscription to the default plan is created transactionally).
func (h *Handler) CreateTenantSuper(c echo.Context) error {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.Bind(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	tenant := &models.Tenant{Name: strings.TrimSpace(req.Name)}
	if err := h.Store.CreateTenantWithDefaultSubscription(c.Request().Context(), tenant); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create tenant"})
	}
	claims := c.Get("user").(*models.JWTCustomClaims)
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "create_tenant", "tenant", tenant.ID, map[string]interface{}{"name": tenant.Name}); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusCreated, tenant)
}

// lifecycle transition table: action → (required current state, new state).
var tenantTransitions = map[string]struct{ from, to string }{
	"suspend":    {"active", "suspended"},
	"reactivate": {"suspended", "active"},
	"archive":    {"suspended", "archived"},
}

func (h *Handler) setTenantStatus(c echo.Context, action string) error {
	tr := tenantTransitions[action]
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}
	current, err := h.Store.GetTenantStatus(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load tenant"})
	}
	if current == "" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}
	if current != tr.from {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": fmt.Sprintf("cannot %s a tenant in state %q (requires %q)", action, current, tr.from),
		})
	}
	if err := h.Store.UpdateTenantStatus(c.Request().Context(), tenantID, tr.to); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update tenant status"})
	}
	claims := c.Get("user").(*models.JWTCustomClaims)
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, action+"_tenant", "tenant", tenantID, map[string]interface{}{"from": current, "to": tr.to}); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusOK, map[string]string{"status": tr.to})
}

func (h *Handler) SuspendTenant(c echo.Context) error    { return h.setTenantStatus(c, "suspend") }
func (h *Handler) ReactivateTenant(c echo.Context) error { return h.setTenantStatus(c, "reactivate") }
func (h *Handler) ArchiveTenant(c echo.Context) error    { return h.setTenantStatus(c, "archive") }
```

(imports: `strings` and `fmt` if not present).

Routes in `handler.go` inside the super-admin block (after the existing tenants routes):

```go
		superAdmin.POST("/tenants", h.CreateTenantSuper)
		superAdmin.POST("/tenants/:id/suspend", h.SuspendTenant)
		superAdmin.POST("/tenants/:id/reactivate", h.ReactivateTenant)
		superAdmin.POST("/tenants/:id/archive", h.ArchiveTenant)
```

- [ ] **Step 4: Run tests + full suite**

Run: `cd backend && go test ./internal/handler/ -run 'TestSuspendTenant|TestArchiveRequires|TestCreateTenantSuper' -v && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/handler.go backend/internal/handler/super_admin_lifecycle_test.go
git commit -m "feat(backend): tenant lifecycle endpoints — create/suspend/reactivate/archive with audit (P1.4)"
```

---

### Task 5: TenantGate — enforced suspension & subscription expiry (P1.2)

**Files:**
- Create: `backend/internal/middleware/tenant_gate.go`
- Create: `backend/internal/middleware/tenant_gate_test.go`
- Modify: `backend/internal/handler/handler.go` (mount after JWT)

**Interfaces:**
- Consumes: `Store.GetTenantStatus` (Task 3), `Store.GetSubscriptionByTenantID` (existing: returns `(nil, nil)` when absent — verify; if it returns ErrNoRows, normalize inside the gate), `models.JWTCustomClaims` from context key `"user"`.
- Produces: `middleware.TenantGate(s store.Store) echo.MiddlewareFunc` — blocks with 403 `{"code":"tenant_suspended"}` when tenant status ∈ {suspended, archived} OR subscription status ∈ {expired, cancelled} OR `end_date` in the past on a non-active-status subscription. Skips `/api/me` (GET) and paths starting `/api/super-admin`. Results cached per tenant for 2 minutes. Missing tenant ("" status) → blocked.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/middleware/tenant_gate_test.go`:

```go
package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type gateFakeStore struct {
	store.Store
	status    string
	statusErr error
	sub       *models.Subscription
	calls     int
}

func (f *gateFakeStore) GetTenantStatus(_ context.Context, id uuid.UUID) (string, error) {
	f.calls++
	return f.status, f.statusErr
}
func (f *gateFakeStore) GetSubscriptionByTenantID(_ context.Context, id uuid.UUID) (*models.Subscription, error) {
	return f.sub, nil
}

func gateRequest(t *testing.T, fs *gateFakeStore, ttl time.Duration, path string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, path, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetPath(path)
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})
	handler := tenantGateWithTTL(fs, ttl)(func(c echo.Context) error {
		return c.NoContent(http.StatusOK)
	})
	if err := handler(c); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
	return rec
}

func TestGateBlocksSuspendedTenant(t *testing.T) {
	fs := &gateFakeStore{status: "suspended"}
	rec := gateRequest(t, fs, 0, "/api/events")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if body := rec.Body.String(); !contains(body, `"code":"tenant_suspended"`) {
		t.Errorf("body %q missing machine-readable code", body)
	}
}

func TestGateAllowsActiveTenantWithActiveSub(t *testing.T) {
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "active"}}
	if rec := gateRequest(t, fs, 0, "/api/events"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestGateBlocksExpiredSubscription(t *testing.T) {
	past := time.Now().Add(-24 * time.Hour)
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "expired", EndDate: &past}}
	if rec := gateRequest(t, fs, 0, "/api/events"); rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestGateSkipsExemptPaths(t *testing.T) {
	fs := &gateFakeStore{status: "suspended"}
	if rec := gateRequest(t, fs, 0, "/api/me"); rec.Code != http.StatusOK {
		t.Fatalf("/api/me status = %d, want 200 (exempt)", rec.Code)
	}
	if rec := gateRequest(t, fs, 0, "/api/super-admin/tenants"); rec.Code != http.StatusOK {
		t.Fatalf("super-admin status = %d, want 200 (exempt)", rec.Code)
	}
	if fs.calls != 0 {
		t.Errorf("store consulted %d times on exempt paths, want 0", fs.calls)
	}
}

func TestGateCachesDecision(t *testing.T) {
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "active"}}
	gate := tenantGateWithTTL(fs, time.Minute)
	e := echo.New()
	tenantID := uuid.New().String()
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/events", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetPath("/api/events")
		c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: tenantID, Role: "admin"})
		if err := gate(func(c echo.Context) error { return c.NoContent(http.StatusOK) })(c); err != nil {
			t.Fatalf("middleware error: %v", err)
		}
	}
	if fs.calls != 1 {
		t.Errorf("store consulted %d times for 3 requests within TTL, want 1", fs.calls)
	}
}

func contains(s, sub string) bool { return len(s) >= len(sub) && strings.Contains(s, sub) }
```

(add `"strings"` import).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/middleware/ -run TestGate -v`
Expected: FAIL to compile — `tenantGateWithTTL` undefined.

- [ ] **Step 3: Implement**

Create `backend/internal/middleware/tenant_gate.go`:

```go
package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TenantGate blocks requests for suspended/archived tenants and lapsed
// subscriptions with a machine-readable body, so every client (web, mobile,
// kiosk) can render "organization suspended" instead of a generic error.
// Decisions are cached per tenant for 2 minutes to avoid a DB hit per request.
func TenantGate(s store.Store) echo.MiddlewareFunc {
	return tenantGateWithTTL(s, 2*time.Minute)
}

type gateEntry struct {
	blocked bool
	expires time.Time
}

func tenantGateWithTTL(s store.Store, ttl time.Duration) echo.MiddlewareFunc {
	var (
		mu    sync.RWMutex
		cache = map[string]gateEntry{}
	)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path
			// Exempt: the caller must still be able to see who they are and
			// (in SaaS) platform operators must never be locked out.
			if path == "/api/me" || strings.HasPrefix(path, "/api/super-admin") {
				return next(c)
			}
			claims, ok := c.Get("user").(*models.JWTCustomClaims)
			if !ok || claims == nil {
				return next(c) // not a tenant-scoped request (JWT middleware guards auth)
			}

			if ttl > 0 {
				mu.RLock()
				entry, hit := cache[claims.TenantID]
				mu.RUnlock()
				if hit && time.Now().Before(entry.expires) {
					if entry.blocked {
						return blockedResponse(c)
					}
					return next(c)
				}
			}

			tenantID, err := uuid.Parse(claims.TenantID)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
			}
			blocked, err := isTenantBlocked(c, s, tenantID)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify tenant status"})
			}
			if ttl > 0 {
				mu.Lock()
				cache[claims.TenantID] = gateEntry{blocked: blocked, expires: time.Now().Add(ttl)}
				mu.Unlock()
			}
			if blocked {
				return blockedResponse(c)
			}
			return next(c)
		}
	}
}

func isTenantBlocked(c echo.Context, s store.Store, tenantID uuid.UUID) (bool, error) {
	status, err := s.GetTenantStatus(c.Request().Context(), tenantID)
	if err != nil {
		return false, err
	}
	if status != "active" { // suspended, archived, or missing ("")
		return true, nil
	}
	sub, err := s.GetSubscriptionByTenantID(c.Request().Context(), tenantID)
	if err != nil || sub == nil {
		// No subscription → the limits middleware already rejects creation;
		// don't hard-lock reads over it. Errors fail open here by design:
		// availability of the whole API must not hinge on the billing table.
		return false, nil
	}
	switch sub.Status {
	case "expired", "cancelled":
		return true, nil
	}
	if sub.EndDate != nil && time.Now().After(*sub.EndDate) && sub.Status != "active" {
		return true, nil
	}
	return false, nil
}

func blockedResponse(c echo.Context) error {
	return c.JSON(http.StatusForbidden, map[string]string{
		"code":  "tenant_suspended",
		"error": "This organization is suspended. Contact support.",
	})
}
```

Mount in `handler.go` immediately after `api.Use(middleware.JWT())`:

```go
	api.Use(middleware.TenantGate(h.Store))
```

- [ ] **Step 4: Run tests + full suite**

Run: `cd backend && go test ./internal/middleware/ -run TestGate -v && go test ./...`
Expected: PASS. Existing handler tests are unaffected (they invoke handlers directly, not through the middleware chain).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/middleware/tenant_gate.go backend/internal/middleware/tenant_gate_test.go backend/internal/handler/handler.go
git commit -m "feat(backend): TenantGate middleware — enforce suspension/expiry with cached 403 tenant_suspended (P1.2)"
```

---

### Task 6: Attendee limit enforcement (P1.3)

**Files:**
- Modify: `backend/internal/store/pg_store.go` (`CheckTenantLimit` — extract limit resolution; new methods)
- Modify: `backend/internal/store/interface.go`
- Modify: `backend/internal/middleware/limits.go` (new middleware)
- Modify: `backend/internal/handler/handler.go:71-72` (attendee routes)
- Modify: `backend/internal/handler/bulk_import.go` (bulk pre-check)
- Modify: `backend/internal/handler/testsupport_test.go`
- Test: extend `backend/internal/middleware/tenant_gate_test.go`? No — new file `backend/internal/middleware/attendee_limits_test.go`

**Interfaces:**
- Produces:
  - `Store.CheckAttendeeLimit(ctx context.Context, tenantID, eventID uuid.UUID, adding int) (allowed bool, current int, max int, err error)` — resolves `attendees_per_event` from custom limits → plan limits (same precedence as `CheckTenantLimit`), `-1` = unlimited, counts `attendees WHERE event_id AND deleted_at IS NULL`, allowed iff `current+adding <= max`.
  - `middleware.CheckAttendeeLimits(s store.Store) echo.MiddlewareFunc` — for the single-create route; reads `:event_id` param, `adding = 1`; 403 body identical in shape to `CheckLimits` (`upgrade_required: true, limit_type: "attendees_per_event"`).
  - Bulk path: `BulkCreateAttendees` handler calls `CheckAttendeeLimit` with `adding = len(req.Attendees)` right after the ownership check, before any insert.
- Consumes: `requireEventOwnership` (bulk handler already has the event from Task 7's refactor if that lands first — tasks 6 and 7 touch different lines of `bulk_import.go`; implement against current code, coordinate via full-suite run).

- [ ] **Step 1: Write the failing middleware test**

Create `backend/internal/middleware/attendee_limits_test.go`:

```go
package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type limitFakeStore struct {
	store.Store
	allowed      bool
	current, max int
}

func (f *limitFakeStore) CheckAttendeeLimit(_ context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
	return f.allowed, f.current, f.max, nil
}

func attendeeLimitRequest(t *testing.T, fs *limitFakeStore) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("event_id")
	c.SetParamValues(uuid.New().String())
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})
	h := CheckAttendeeLimits(fs)(func(c echo.Context) error { return c.NoContent(http.StatusCreated) })
	if err := h(c); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
	return rec
}

func TestAttendeeLimitBlocksWhenFull(t *testing.T) {
	rec := attendeeLimitRequest(t, &limitFakeStore{allowed: false, current: 50, max: 50})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestAttendeeLimitPassesWhenUnderLimit(t *testing.T) {
	rec := attendeeLimitRequest(t, &limitFakeStore{allowed: true, current: 3, max: 50})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/middleware/ -run TestAttendeeLimit -v`
Expected: FAIL to compile — `CheckAttendeeLimits` / `CheckAttendeeLimit` undefined.

- [ ] **Step 3: Store implementation**

In `backend/internal/store/pg_store.go`, extract the limit-resolution block of `CheckTenantLimit` (custom-limits override → plan limits, both `float64` casts) into:

```go
// resolveTenantLimit returns the effective value for limitType: custom
// subscription limits override plan limits; 0 means "not configured".
func (s *PGStore) resolveTenantLimit(ctx context.Context, tenantID uuid.UUID, limitType string) (float64, error) {
	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil || sub == nil {
		return 0, fmt.Errorf("no active subscription")
	}
	var maxLimit float64
	if sub.CustomLimits != nil {
		if val, ok := sub.CustomLimits[limitType]; ok {
			floatVal, ok := val.(float64)
			if !ok {
				return 0, fmt.Errorf("invalid custom limit type for %s", limitType)
			}
			maxLimit = floatVal
		}
	}
	if maxLimit == 0 && sub.Plan != nil && sub.Plan.Limits != nil {
		if val, ok := sub.Plan.Limits[limitType]; ok {
			floatVal, ok := val.(float64)
			if !ok {
				return 0, fmt.Errorf("invalid plan limit type for %s", limitType)
			}
			maxLimit = floatVal
		}
	}
	return maxLimit, nil
}
```

Rewrite `CheckTenantLimit` to call it (drop the duplicated block and DELETE the dead `case "attendees_per_event"` branch), and add:

```go
// CheckAttendeeLimit enforces attendees_per_event for one event, counting
// soft-deleted attendees out. adding is the number about to be created
// (1 for single create, len(batch) for bulk import).
func (s *PGStore) CheckAttendeeLimit(ctx context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
	maxLimit, err := s.resolveTenantLimit(ctx, tenantID, "attendees_per_event")
	if err != nil {
		return false, 0, 0, err
	}
	if maxLimit == -1 {
		return true, 0, -1, nil
	}
	var current int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`,
		eventID).Scan(&current); err != nil {
		return false, 0, 0, fmt.Errorf("failed to count attendees: %w", err)
	}
	return current+adding <= int(maxLimit), current, int(maxLimit), nil
}
```

Interface addition:

```go
	CheckAttendeeLimit(ctx context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error)
```

fakeStore addition:

```go
	checkAttendeeLimit func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error)
```

```go
func (f *fakeStore) CheckAttendeeLimit(_ context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
	return f.checkAttendeeLimit(tenantID, eventID, adding)
}
```

- [ ] **Step 4: Middleware + wiring**

Append to `backend/internal/middleware/limits.go`:

```go
// CheckAttendeeLimits enforces attendees_per_event for the event in the
// route (:event_id). Single-create path only — bulk import validates its
// batch size in the handler where the count is known.
func CheckAttendeeLimits(s store.Store) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get("user").(*models.JWTCustomClaims)
			if !ok {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			}
			tenantID, err := uuid.Parse(claims.TenantID)
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
			}
			eventID, err := uuid.Parse(c.Param("event_id"))
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
			}
			allowed, current, max, err := s.CheckAttendeeLimit(c.Request().Context(), tenantID, eventID, 1)
			if err != nil || !allowed {
				return c.JSON(http.StatusForbidden, map[string]interface{}{
					"error":            "Limit exceeded for attendees_per_event",
					"current":          current,
					"max":              max,
					"upgrade_required": true,
					"limit_type":       "attendees_per_event",
				})
			}
			return next(c)
		}
	}
}
```

In `handler.go` replace lines 71–72:

```go
	api.POST("/events/:event_id/attendees", h.CreateAttendee, middleware.CheckAttendeeLimits(h.Store))
	api.POST("/events/:event_id/attendees/bulk", h.BulkCreateAttendees)
```

In `backend/internal/handler/bulk_import.go`, right after the event-ownership check and before the field-schema update, insert:

```go
	// P1.3: validate the whole batch against attendees_per_event before inserting.
	allowed, current, max, err := h.Store.CheckAttendeeLimit(c.Request().Context(), event.TenantID, eventID, len(req.Attendees))
	if err != nil || !allowed {
		return c.JSON(http.StatusForbidden, map[string]interface{}{
			"error":            "Limit exceeded for attendees_per_event",
			"current":          current,
			"max":              max,
			"adding":           len(req.Attendees),
			"upgrade_required": true,
			"limit_type":       "attendees_per_event",
		})
	}
```

(uses `event.TenantID` from the ownership check in scope).

- [ ] **Step 5: Bulk handler test**

Append to `backend/internal/handler/tenant_isolation_test.go`:

```go
// Bulk import must validate the batch size against the plan limit before inserting.
func TestBulkImportRejectsOverLimitBatch(t *testing.T) {
	e := echo.New()
	tenant := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenant}, nil
		},
		checkAttendeeLimit: func(_, _ uuid.UUID, adding int) (bool, int, int, error) {
			return false, 45, 50, nil
		},
	}
	h := &Handler{Store: fs}
	body := `{"attendees":[{"first_name":"a"},{"first_name":"b"},{"first_name":"c"},{"first_name":"d"},{"first_name":"e"},{"first_name":"f"}]}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, tenant.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (batch over limit)", rec.Code)
	}
}
```

- [ ] **Step 6: Run everything**

Run: `cd backend && go build ./... && go test ./... && go vet ./...`
Expected: PASS (middleware tests, bulk test, full suite).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/store/ backend/internal/middleware/limits.go backend/internal/middleware/attendee_limits_test.go backend/internal/handler/
git commit -m "feat(backend): enforce attendees_per_event — event-scoped middleware + bulk pre-check (P1.3)"
```

---

### Task 7: Isolation sweep — remaining oracles + zone-assignment authz (P1.9)

**Files:**
- Modify: `backend/internal/handler/badge_zpl.go:69-92`
- Modify: `backend/internal/handler/attendee_codes.go` (`GenerateAttendeeCodes` ~:22-28, `ExportAttendeesCSV` ~:76-82)
- Modify: `backend/internal/handler/bulk_import.go:57-65`
- Modify: `backend/internal/handler/zones.go:387-405` (`GetUserZoneAssignments`)
- Modify: `backend/internal/handler/tenant_isolation_test.go` (new suite cases)

**Interfaces:**
- Consumes: `requireEventOwnership`, `requireAttendeeOwnership`, `writeErr` (Phase 0 authz.go), `Store.GetUserTenantRole` (existing), fakeStore fields `getEventByID`, `getAttendeeByID`, `getUserTenantRole`.
- Produces: behavior only — uniform 404 for foreign/missing on the four remaining routes; `GetUserZoneAssignments` authorizes by active-tenant membership.

- [ ] **Step 1: Extend the isolation suite (failing first)**

Add cases to the `cases` slice in `TestCrossTenantAccessIs404` (`tenant_isolation_test.go`) — the fixture already defines `eventID`/`attendeeID` owned by `ownerTenant`:

```go
		{"BadgeZPL", http.MethodPost, `{"attendee_id":"` + attendeeID.String() + `"}`, "id", eventID.String(), h.BadgeZPL},
		{"GenerateAttendeeCodes", http.MethodPost, "", "event_id", eventID.String(), h.GenerateAttendeeCodes},
		{"ExportAttendeesCSV", http.MethodGet, "", "event_id", eventID.String(), h.ExportAttendeesCSV},
		{"BulkCreateAttendees", http.MethodPost, `{"attendees":[{"first_name":"x"}]}`, "event_id", eventID.String(), h.BulkCreateAttendees},
```

Check the actual param name used by `BadgeZPL` (`c.Param(...)` at the top of the handler — the route is `/events/:id/badge-zpl`, so `"id"`); adjust if it reads a different key.

And a membership test:

```go
// GetUserZoneAssignments must authorize via active-tenant membership, not
// the target's home users.tenant_id (P1.9 — same class as the P0.2 users.go fix).
func TestZoneAssignmentsUseActiveTenantMembership(t *testing.T) {
	e := echo.New()
	activeTenant := uuid.New()
	targetID := uuid.New()
	fs := &fakeStore{
		getUserTenantRole: func(userID, tenantID uuid.UUID) (string, error) {
			if userID == targetID && tenantID == activeTenant {
				return "staff", nil
			}
			return "", nil
		},
		getStaffZoneAssignments: func(userID uuid.UUID) ([]*models.StaffZoneAssignment, error) {
			return []*models.StaffZoneAssignment{}, nil
		},
	}
	h := &Handler{Store: fs}

	// Member of the active tenant (home tenant irrelevant) → 200.
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", activeTenant.String(), "admin")
	c.SetParamNames("user_id")
	c.SetParamValues(targetID.String())
	if err := h.GetUserZoneAssignments(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("member: status = %d, want 200", rec.Code)
	}

	// Non-member → uniform 404.
	c2, rec2 := newAuthedContext(e, http.MethodGet, "/x", "", uuid.New().String(), "admin")
	c2.SetParamNames("user_id")
	c2.SetParamValues(targetID.String())
	if err := h.GetUserZoneAssignments(c2); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("non-member: status = %d, want 404", rec2.Code)
	}
}
```

(`getStaffZoneAssignments` already exists as a fakeStore field from Phase 2B tests — verify; add if absent following the established pattern.)

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && go test ./internal/handler/ -run 'TestCrossTenant|TestZoneAssignments' -v`
Expected: FAIL — new cases return 403 (or 200 for the membership case) instead of 404.

- [ ] **Step 3: Refactor the four handlers**

`badge_zpl.go` — replace the manual event fetch + tenant check + attendee fetch block with:

```go
	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}
	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
	}
	if attendee.EventID != eventID {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Attendee does not belong to this event"})
	}
```

(delete the now-unused `user := c.Get("user")...` / `tenantID` lines; this also stops leaking raw store errors via `err.Error()`).

`attendee_codes.go`, both handlers — replace:

```go
	user := c.Get("user").(*models.JWTCustomClaims)
	event, err := h.Store.GetEventByID(c.Request().Context(), eventID)
	if err != nil || event == nil || event.TenantID.String() != user.TenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}
```

with (in `GenerateAttendeeCodes`, where `event` is unused afterwards):

```go
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}
```

and (in `ExportAttendeesCSV`, which uses `event` for the field schema — keep the binding):

```go
	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}
```

`bulk_import.go` — replace the claims-parse + event fetch + tenant compare block with:

```go
	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}
```

(the Task 6 limit check below it uses `event.TenantID`; the `user`/`tenantID` locals go away — remove their imports if orphaned).

`zones.go` `GetUserZoneAssignments` — replace the `GetUserByID` + home-tenant compare block with:

```go
	// Membership in the caller's ACTIVE tenant (user_tenants) authorizes;
	// non-members and unknown ids are the same uniform 404.
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), userID, tenantID)
	if err != nil || role == "" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}
```

- [ ] **Step 4: Run tests + full suite**

Run: `cd backend && go build ./... && go test ./... && go vet ./...`
Expected: PASS. If any pre-existing test asserted 403 on these four routes for cross-tenant fixtures, update it to 404 (ownership-path only — list each change in the commit message body).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/
git commit -m "fix(backend): close remaining cross-tenant oracles; zone assignments via active-tenant membership (P1.9)"
```

---

### Task 8: Transactional registration (P1.10a)

**Files:**
- Modify: `backend/internal/store/pg_store.go` (next to `CreateTenantWithDefaultSubscription`)
- Modify: `backend/internal/store/interface.go`
- Modify: `backend/internal/handler/auth.go` (`Register`)
- Modify: `backend/internal/handler/auth_register_test.go`, `backend/internal/handler/testsupport_test.go`

**Interfaces:**
- Produces: `Store.ProvisionTenantWithAdmin(ctx context.Context, tenantName, email, passwordHash string) (*models.Tenant, *models.User, error)` — ONE transaction: tenant insert → default-plan subscription (ErrNoRows → `"no default subscription plan configured"`) → user lookup by email (existing user is reused, passwordHash ignored for them — preserves current behavior) or insert → `user_tenants` membership (role admin). Killing the process at any point leaves no partial rows.
- Consumes: nothing new. `CreateTenantWithDefaultSubscription` REMAINS (used by `CreateTenantSuper`, Task 4).

- [ ] **Step 1: Update the register test (failing first)**

In `backend/internal/handler/auth_register_test.go`, replace `TestRegisterProvisionsDefaultSubscription` with:

```go
func TestRegisterProvisionsAtomically(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()

	provisioned := false
	fs := &fakeStore{
		provisionTenantWithAdmin: func(tenantName, email, passwordHash string) (*models.Tenant, *models.User, error) {
			if tenantName != "Acme" || email != "owner@acme.test" || passwordHash == "" {
				t.Errorf("unexpected args: %q %q hash-empty=%v", tenantName, email, passwordHash == "")
			}
			provisioned = true
			tenant := &models.Tenant{ID: uuid.New(), Name: tenantName}
			user := &models.User{ID: uuid.New(), TenantID: tenant.ID, Email: email, Role: "admin"}
			return tenant, user, nil
		},
		getUserTenants: func(userID uuid.UUID) ([]*models.Tenant, error) { return nil, nil },
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/auth/register",
		strings.NewReader(`{"tenant_name":"Acme","email":"owner@acme.test","password":"secret123"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := h.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if rec.Code != http.StatusCreated || !provisioned {
		t.Fatalf("status=%d provisioned=%v; body: %s", rec.Code, provisioned, rec.Body.String())
	}
}
```

fakeStore addition:

```go
	provisionTenantWithAdmin func(tenantName, email, passwordHash string) (*models.Tenant, *models.User, error)
```

```go
func (f *fakeStore) ProvisionTenantWithAdmin(_ context.Context, tenantName, email, passwordHash string) (*models.Tenant, *models.User, error) {
	return f.provisionTenantWithAdmin(tenantName, email, passwordHash)
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/handler/ -run TestRegisterProvisions -v`
Expected: FAIL to compile (interface lacks the method) or provisioned=false.

- [ ] **Step 3: Store method**

Interface (tenant section):

```go
	// ProvisionTenantWithAdmin registers a tenant end-to-end in one
	// transaction: tenant, default-plan subscription, admin user (created or
	// reused by email), user_tenants membership. No orphan rows on failure.
	ProvisionTenantWithAdmin(ctx context.Context, tenantName, email, passwordHash string) (*models.Tenant, *models.User, error)
```

`pg_store.go` (after `CreateTenantWithDefaultSubscription`):

```go
func (s *PGStore) ProvisionTenantWithAdmin(ctx context.Context, tenantName, email, passwordHash string) (*models.Tenant, *models.User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Printf("rollback tenant registration: %v", err)
		}
	}()

	tenant := &models.Tenant{Name: tenantName}
	if err := tx.QueryRow(ctx,
		`INSERT INTO tenants (name) VALUES ($1) RETURNING id, created_at, updated_at`,
		tenant.Name).Scan(&tenant.ID, &tenant.CreatedAt, &tenant.UpdatedAt); err != nil {
		return nil, nil, err
	}

	var planID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM subscription_plans WHERE is_default AND is_active ORDER BY sort_order LIMIT 1`).Scan(&planID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, fmt.Errorf("no default subscription plan configured: %w", err)
		}
		return nil, nil, fmt.Errorf("lookup default subscription plan: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO subscriptions (tenant_id, plan_id, status, start_date) VALUES ($1, $2, 'active', NOW())`,
		tenant.ID, planID); err != nil {
		return nil, nil, err
	}

	user := &models.User{Email: email}
	err = tx.QueryRow(ctx,
		`SELECT id, tenant_id, role FROM users WHERE email = $1`, email).
		Scan(&user.ID, &user.TenantID, &user.Role)
	switch {
	case err == pgx.ErrNoRows:
		user.TenantID = tenant.ID
		user.Role = "admin"
		user.PasswordHash = passwordHash
		if err := tx.QueryRow(ctx,
			`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id, created_at`,
			user.TenantID, user.Email, user.PasswordHash).Scan(&user.ID, &user.CreatedAt); err != nil {
			return nil, nil, err
		}
	case err != nil:
		return nil, nil, err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO user_tenants (user_id, tenant_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())
		 ON CONFLICT (user_id, tenant_id) DO NOTHING`,
		user.ID, tenant.ID); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return tenant, user, nil
}
```

Before finalizing, open migration `backend/migrations/000008_multi_org_support.up.sql` and check the exact `users` and `user_tenants` column lists (e.g. whether `users` INSERT needs more NOT NULL columns and whether `user_tenants` has the `(user_id, tenant_id)` unique constraint the ON CONFLICT targets); align the SQL with what exists, and verify against `CreateUser`/`AddUserToTenant` in the same file.

- [ ] **Step 4: Rewire Register**

In `backend/internal/handler/auth.go`, replace steps 1–3 of `Register` (tenant creation through `AddUserToTenant`) with:

```go
	// Hash before opening the transaction (bcrypt is slow; don't hold a tx).
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to process password"})
	}

	// One transaction: tenant + subscription + user + membership (P1.10).
	tenant, existingUser, err := h.Store.ProvisionTenantWithAdmin(
		c.Request().Context(), req.TenantName, req.Email, string(hashedPassword))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create tenant"})
	}
```

(steps 4–5, token + tenants list + response, stay unchanged — they reference `existingUser` and `tenant.ID`).

- [ ] **Step 5: Run tests + e2e smoke**

Run: `cd backend && go build ./... && go test ./... && go vet ./...` — PASS.

E2E (same docker pattern as Task 2 Step 5): register → login → create event → all 201/200; then `docker exec idento_db psql -U idento -d idento_db -tc "SELECT count(*) FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.tenant_id = t.id)"` → `0` (no orphan tenants).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/ backend/internal/handler/auth.go backend/internal/handler/auth_register_test.go backend/internal/handler/testsupport_test.go
git commit -m "fix(backend): fully transactional registration — no orphan tenants (P1.10)"
```

---

### Task 9: Race-safe subscription upsert (P1.10b)

**Files:**
- Modify: `backend/internal/store/pg_store.go` (next to `CreateSubscription`)
- Modify: `backend/internal/store/interface.go`
- Modify: `backend/internal/handler/super_admin.go` (`UpdateTenantSubscription` isNew branch)
- Modify: `backend/internal/handler/super_admin_subscription_test.go`, `testsupport_test.go`

**Interfaces:**
- Produces: `Store.UpsertSubscription(ctx context.Context, sub *models.Subscription) error` — `INSERT ... ON CONFLICT (tenant_id) DO UPDATE` (all mutable fields), fills `sub.ID/CreatedAt/UpdatedAt` via RETURNING. Two concurrent PATCHes for a subscription-less tenant both succeed (one insert, one update).
- Consumes: existing `models.Subscription`.

- [ ] **Step 1: Update the upsert test (failing first)**

In `super_admin_subscription_test.go`, in `TestUpdateTenantSubscriptionCreatesWhenMissing`, replace the `createSubscription` fixture/assertion with `upsertSubscription`:

```go
		upsertSubscription: func(sub *models.Subscription) error {
			created = sub
			return nil
		},
```

fakeStore:

```go
	upsertSubscription func(sub *models.Subscription) error
```

```go
func (f *fakeStore) UpsertSubscription(_ context.Context, sub *models.Subscription) error {
	return f.upsertSubscription(sub)
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/handler/ -run TestUpdateTenantSubscription -v`
Expected: FAIL to compile / fixture not called.

- [ ] **Step 3: Implement**

`pg_store.go`:

```go
// UpsertSubscription inserts or replaces the tenant's single subscription
// row atomically — concurrent create attempts cannot 500 on UNIQUE(tenant_id).
func (s *PGStore) UpsertSubscription(ctx context.Context, sub *models.Subscription) error {
	customLimitsJSON, err := json.Marshal(sub.CustomLimits)
	if err != nil {
		return fmt.Errorf("failed to marshal custom limits: %w", err)
	}
	customFeaturesJSON, err := json.Marshal(sub.CustomFeatures)
	if err != nil {
		return fmt.Errorf("failed to marshal custom features: %w", err)
	}
	query := `INSERT INTO subscriptions
	          (tenant_id, plan_id, status, start_date, end_date, trial_end_date,
	           custom_limits, custom_features, payment_method, admin_notes, created_by)
	          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	          ON CONFLICT (tenant_id) DO UPDATE SET
	            plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
	            start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
	            trial_end_date = EXCLUDED.trial_end_date,
	            custom_limits = EXCLUDED.custom_limits, custom_features = EXCLUDED.custom_features,
	            payment_method = EXCLUDED.payment_method, admin_notes = EXCLUDED.admin_notes,
	            updated_at = NOW()
	          RETURNING id, created_at, updated_at`
	return s.db.QueryRow(ctx, query,
		sub.TenantID, sub.PlanID, sub.Status, sub.StartDate, sub.EndDate, sub.TrialEndDate,
		customLimitsJSON, customFeaturesJSON, sub.PaymentMethod, sub.AdminNotes, sub.CreatedBy,
	).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt)
}
```

Interface: `UpsertSubscription(ctx context.Context, sub *models.Subscription) error` in the Subscriptions section.

`super_admin.go` isNew branch: replace `h.Store.CreateSubscription(...)` with `h.Store.UpsertSubscription(...)` (error message unchanged).

- [ ] **Step 4: Run + commit**

Run: `cd backend && go build ./... && go test ./... && go vet ./...` — PASS.

```bash
git add backend/internal/store/ backend/internal/handler/super_admin.go backend/internal/handler/super_admin_subscription_test.go backend/internal/handler/testsupport_test.go
git commit -m "fix(backend): race-safe subscription upsert via ON CONFLICT (P1.10)"
```

---

### Task 10: Web handling of tenant_suspended (P1.2 client)

**Files:**
- Modify: `web/src/lib/api.ts` (response interceptor)
- Modify: `web/src/i18n.ts` (EN + RU keys)

**Interfaces:**
- Consumes: backend 403 body `{"code": "tenant_suspended"}` (Task 5); `sonner` toast (already a dependency); the global `i18next` instance initialized by `web/src/i18n.ts`.
- Produces: any API 403 with that code raises one persistent toast (deduplicated by id) in the UI language.

- [ ] **Step 1: Add translations**

In `web/src/i18n.ts`, add to the EN `translation` object (Common section):

```ts
          tenantSuspended: "This organization is suspended. Contact support to restore access.",
```

and to the RU `translation` object (same section):

```ts
          tenantSuspended: "Организация приостановлена. Обратитесь в поддержку для восстановления доступа.",
```

- [ ] **Step 2: Extend the response interceptor**

In `web/src/lib/api.ts`, add imports:

```ts
import { toast } from 'sonner';
import i18n from 'i18next';
```

Inside the response interceptor's error handler, before the 401 block:

```ts
    // Suspended/blocked organization: one persistent, deduplicated banner.
    if (error.response?.status === 403 && error.response?.data?.code === 'tenant_suspended') {
      toast.error(i18n.t('tenantSuspended'), { id: 'tenant-suspended', duration: Infinity });
    }
```

- [ ] **Step 3: Verify build + lint**

Run: `cd web && npm ci --no-audit --no-fund && npx tsc -b && npm run lint && npm run build 2>&1 | tail -3`
Expected: type-check, lint, and build all pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts web/src/i18n.ts
git commit -m "feat(web): persistent banner for tenant_suspended API responses (P1.2)"
```

---

## Final Verification (whole batch)

- [ ] `cd backend && go build ./... && go test ./... && go vet ./... && golangci-lint run ./internal/... && gofmt -l .` — all green, gofmt empty.
- [ ] `cd web && npx tsc -b && npm run lint` — green.
- [ ] E2E saas (docker, fresh DB): startup seeds 4 plans + free default → register → create event 201 → super-admin suspend (requires a super-admin user: `go run ./cmd/create_super_admin` against the dev DB, then login) → any API call returns 403 `{"code":"tenant_suspended"}` within 2 minutes → reactivate → calls succeed.
- [ ] E2E onprem (same DB reset, `DEPLOYMENT_MODE=onprem`): startup seeds only `unlimited` default; `POST /auth/register` → 404; `GET /api/super-admin/plans` → 404.
- [ ] Attendee limit: with the free plan (50/event), a 51-attendee bulk import → 403 with `limit_type: attendees_per_event`.
- [ ] `git log --oneline` maps commits to P1.1–P1.4, P1.9–P1.10.
- [ ] Re-read each item's "Accept" line in `docs/DUAL_DISTRIBUTION_REWORK.md` §Phase 1 for P1.1–P1.4, P1.9, P1.10 — all satisfied (P1.2's "clients" = web in this batch; mobile/kiosk noted in the PR as follow-up).

## Out of Scope (this batch)

P1.5 impersonation, P1.6 analytics, P1.7 audit completion, P1.8 tenant-admin UI (subsequent batches); mobile/kiosk handling of `tenant_suspended` (follow-up task — they currently show a generic error); retention/purge job for archived tenants (archive is a blocked state only); Phase 2 on-prem bootstrap/packaging.
