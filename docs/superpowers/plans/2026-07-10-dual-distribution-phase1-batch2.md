# Dual Distribution Phase 1 — Batch 2 (Operator Tooling Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for the platform-operator toolkit — impersonation with full attribution (P1.5), real platform analytics (P1.6), completed audit log (P1.7) — plus the code-hygiene backlog from Batch 1 reviews. UI (P1.8) ships in the next batch on top of these endpoints.

**Architecture:** All Go backend (module `idento/backend`, Echo + pgx). Impersonation is a second, short-lived JWT flavor: same claims struct plus an `imp_by` marker; a dedicated middleware audits every impersonated mutation. Analytics is pure SQL aggregates behind one store method. Audit completion is a signature extension (ip/user-agent) plus one supported filter.

**Tech Stack:** Go 1.25+ (toolchain 1.26.5), Echo v4, pgx/v5, golang-jwt/v5, existing `fakeStore` harness.

## Global Constraints

- Module `idento/backend`; Go commands from `backend/`; gates before every commit: `go build ./... && go test ./... && go vet ./...`, `golangci-lint run ./internal/...` (0 issues), `gofmt -l .` (empty).
- HARD RULE (standing, from the Batch 1 incident): never modify `middleware.JWT`, `SuperAdminOnly`, or `TenantGate` mounting/logic beyond what a task explicitly names. If a test expectation fails against real behavior, report BLOCKED — do not weaken checks.
- Impersonation tokens: TTL exactly 30 minutes; claims carry `imp_by` = the super admin's user id; `UserID` in claims is ALSO the super admin's id (attribution — actions must never appear to come from a customer's user). Minting requires target tenant status `active` (409 otherwise); a caller whose own token has `imp_by` set is rejected (403, no nested impersonation). There is no refresh mechanism in the codebase, so nothing to forbid there.
- Every mutating request (POST/PUT/PATCH/DELETE) carrying `imp_by` is audit-logged best-effort (log-and-continue on failure); reads are not logged.
- Audit rows must carry `ip_address` (`c.RealIP()`) and `user_agent` (`c.Request().UserAgent()`) from this batch on.
- Store errors are 500, never masked as 404/403 (branch-wide contract from Batch 1).
- Cross-cutting: impersonation endpoints live INSIDE the existing saas-only super-admin block (onprem never mounts them).
- No new third-party dependencies.
- Roadmap acceptance: `docs/DUAL_DISTRIBUTION_REWORK.md` §Phase 1 items P1.5, P1.6, P1.7.
- E2E verifications use the docker dev DB exactly as Batch 1 (`docker compose up -d db`, port 5438; container may already exist — `docker compose start db` then).

## File Structure

```text
backend/
├── internal/models/auth.go                 (mod)  — ImpersonatedBy claim
├── internal/models/models.go               (mod)  — PlatformAnalytics structs
├── internal/handler/auth.go                (mod)  — generateImpersonationToken
├── internal/handler/super_admin.go         (mod)  — ImpersonateTenant, analytics impl, audit ip/ua at call sites, ?action= filter
├── internal/handler/super_admin_impersonation_test.go (new)
├── internal/handler/super_admin_analytics_test.go     (new)
├── internal/handler/handler.go             (mod)  — impersonate route; ImpersonationAudit mount
├── internal/handler/authz.go               (mod)  — claimsFromContext helper
├── internal/middleware/impersonation_audit.go      (new)
├── internal/middleware/impersonation_audit_test.go (new)
├── internal/middleware/tenant_gate.go      (mod)  — bounded cache sweep
├── internal/store/interface.go             (mod)  — LogAdminAction signature; GetPlatformAnalytics; dead methods removed
├── internal/store/pg_store.go              (mod)  — same + GetAuditLog action filter + GetAllTenants aliases
├── internal/store/pg_store_super_admin.go  (check) — GetAllUsers lives here; untouched unless grep says otherwise
├── internal/handler/testsupport_test.go    (mod)  — fakeStore signature updates, dead fields removed
├── migrations/000014_audit_indexes.{up,down}.sql   (new)
```

Execution note: at execution start, commit this plan file to the feature branch.

Task order matters: Task 1 (audit signature) lands first because Tasks 3–5 call the new signature.

---

### Task 1: LogAdminAction carries ip/user-agent (P1.7a)

**Files:**
- Modify: `backend/internal/store/interface.go` (Audit section), `backend/internal/store/pg_store.go` (`LogAdminAction` impl)
- Modify: `backend/internal/handler/super_admin.go` (all 5 `LogAdminAction` call sites)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore field + method), plus every test fixture assigning `logAdminAction` (grep `logAdminAction:` — super_admin_subscription_test.go, super_admin_lifecycle_test.go)

**Interfaces:**
- Produces: `LogAdminAction(ctx context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error` — the ONLY audit-write signature from now on; Tasks 3–4 call it.
- Consumes: existing `admin_audit_log.ip_address/user_agent` columns (migration 000009 — already exist, currently always NULL).

- [ ] **Step 1: Update the interface and implementation**

Interface (Audit section):

```go
	// LogAdminAction records a platform-operator action with request
	// attribution (ip/user_agent from the HTTP request that caused it).
	LogAdminAction(ctx context.Context, adminID uuid.UUID, action string, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error
```

In `pg_store.go`, find the current `LogAdminAction` implementation, add the two parameters, and include them in the INSERT (the columns exist; current INSERT omits them — add `ip_address, user_agent` to the column list and `$n` placeholders, passing `nullIfEmpty(ip)`-style handling: pass the strings directly; empty string is acceptable, do NOT invent a helper).

- [ ] **Step 2: Update call sites and fakeStore**

All 5 call sites in `super_admin.go` append `, c.RealIP(), c.Request().UserAgent()`. fakeStore:

```go
	logAdminAction func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error
```

```go
func (f *fakeStore) LogAdminAction(_ context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
	return f.logAdminAction(adminID, action, targetType, targetID, changes, ip, userAgent)
}
```

Update every test fixture assigning `logAdminAction:` to the new signature (mechanical — the compiler lists them).

- [ ] **Step 3: Add an assertion that ip/ua reach the store**

In `super_admin_lifecycle_test.go`, extend `TestSuspendTenantFromActive`'s fixture:

```go
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAction, gotIP, gotUA = action, ip, userAgent
			return nil
		},
```

(declare `var gotAction, gotIP, gotUA string` above) and assert after the call:

```go
	if gotAction != "suspend_tenant" || gotIP == "" || gotUA == "" {
		t.Errorf("audit attribution missing: action=%q ip=%q ua=%q", gotAction, gotIP, gotUA)
	}
```

Note: `newAuthedContext` builds requests via `httptest.NewRequest`, which sets RemoteAddr `192.0.2.1:1234` — so `c.RealIP()` is non-empty in tests; set a UA header in the fixture context if empty: add `req.Header.Set("User-Agent", "test-agent")` inside `newAuthedContext` (one line, benefits every test).

- [ ] **Step 4: Gates + commit**

Run: `cd backend && go build ./... && go test ./... && go vet ./... && gofmt -l .`
Expected: green/empty.

```bash
git add backend/internal/store/ backend/internal/handler/
git commit -m "feat(backend): audit log records ip/user-agent on every admin action (P1.7)"
```

---

### Task 2: Audit-log filtering + indexes (P1.7b)

**Files:**
- Create: `backend/migrations/000014_audit_indexes.up.sql`, `.down.sql`
- Modify: `backend/internal/store/pg_store.go` (`GetAuditLog` — filters are currently accepted and silently ignored)
- Modify: `backend/internal/handler/super_admin.go` (`GetAuditLog` handler — wire `?action=`)

**Interfaces:**
- Produces: `GetAuditLog` honors `filters["action"] string` (exact match); handler accepts `?action=` query param. Count query uses the same WHERE.
- Consumes: nothing new.

- [ ] **Step 1: Migration**

`backend/migrations/000014_audit_indexes.up.sql`:

```sql
-- P1.7: the audit log is queried newest-first and filtered by action
-- (e.g. impersonate_tenant, impersonated_request).
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
```

`.down.sql`:

```sql
DROP INDEX IF EXISTS idx_admin_audit_action;
DROP INDEX IF EXISTS idx_admin_audit_created;
```

- [ ] **Step 2: Store filter support**

Rewrite the query construction in `GetAuditLog` (`pg_store.go`):

```go
	where := ""
	args := []interface{}{}
	if action, ok := filters["action"].(string); ok && action != "" {
		where = "WHERE action = $1"
		args = append(args, action)
	}
	query := fmt.Sprintf(`SELECT id, admin_user_id, action, target_type, target_id, changes, ip_address, user_agent, created_at
	          FROM admin_audit_log %s
	          ORDER BY created_at DESC
	          LIMIT $%d OFFSET $%d`, where, len(args)+1, len(args)+2)
	rows, err := s.db.Query(ctx, query, append(args, limit, offset)...)
```

and the count:

```go
	countQuery := "SELECT COUNT(*) FROM admin_audit_log " + where
	if err := s.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
```

(keep the rest of the scan loop unchanged).

- [ ] **Step 3: Handler wiring + test**

In the `GetAuditLog` handler, after `filters := make(map[string]interface{})`:

```go
	if action := c.QueryParam("action"); action != "" {
		filters["action"] = action
	}
```

Handler-level test (new func in `super_admin_lifecycle_test.go` or a small new file): fakeStore `getAuditLog` fixture captures the filters map; request with `?action=impersonate_tenant`; assert `filters["action"] == "impersonate_tenant"`. Add the fakeStore field/method for `GetAuditLog` if absent (check first):

```go
	getAuditLog func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error)
```

```go
func (f *fakeStore) GetAuditLog(_ context.Context, filters map[string]interface{}, limit int, offset int) ([]*models.AdminAuditLog, int, error) {
	return f.getAuditLog(filters, limit, offset)
}
```

- [ ] **Step 4: Gates + commit**

```bash
git add backend/migrations/000014_audit_indexes.up.sql backend/migrations/000014_audit_indexes.down.sql backend/internal/store/pg_store.go backend/internal/handler/
git commit -m "feat(backend): audit log action filter + indexes (P1.7)"
```

---

### Task 3: Impersonation mint endpoint (P1.5a)

**Files:**
- Modify: `backend/internal/models/auth.go` (claims), `backend/internal/handler/auth.go` (token helper), `backend/internal/handler/super_admin.go` (handler), `backend/internal/handler/handler.go` (route)
- Create: `backend/internal/handler/super_admin_impersonation_test.go`

**Interfaces:**
- Consumes: `LogAdminAction` new signature (Task 1); `GetTenantStatus` ("" = missing); `config.JWTSecret()`.
- Produces:
  - `models.JWTCustomClaims.ImpersonatedBy string json:"imp_by,omitempty"` — Task 4's middleware keys off it.
  - `generateImpersonationToken(superAdmin uuid, tenantID string) (token string, expiresAt time.Time, err error)` in auth.go — 30-min TTL, Role "admin", UserID = ImpersonatedBy = superAdmin id.
  - Route `POST /api/super-admin/tenants/:id/impersonate` → 200 `{"token": ..., "expires_at": ..., "tenant_id": ...}`; 404 missing tenant; 409 non-active tenant; 403 when the caller's own token carries `imp_by`.

- [ ] **Step 1: Failing tests**

Create `backend/internal/handler/super_admin_impersonation_test.go`:

```go
package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestImpersonateActiveTenant(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()
	target := uuid.New()
	audited := ""
	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			audited = action
			return nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(target.String())

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK || audited != "impersonate_tenant" {
		t.Fatalf("status=%d audited=%q; want 200/impersonate_tenant; body: %s", rec.Code, audited, rec.Body.String())
	}
	var resp struct {
		Token    string `json:"token"`
		TenantID string `json:"tenant_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.Token == "" {
		t.Fatalf("bad response: %v / %s", err, rec.Body.String())
	}
	// The minted token must carry imp_by and the target tenant.
	parsed, err := jwt.ParseWithClaims(resp.Token, &models.JWTCustomClaims{}, func(*jwt.Token) (interface{}, error) {
		return []byte("test-secret"), nil
	})
	if err != nil {
		t.Fatalf("minted token does not parse: %v", err)
	}
	claims := parsed.Claims.(*models.JWTCustomClaims)
	if claims.ImpersonatedBy == "" || claims.TenantID != target.String() || claims.Role != "admin" {
		t.Errorf("claims = %+v; want imp_by set, tenant %s, role admin", claims, target)
	}
	if claims.UserID != claims.ImpersonatedBy {
		t.Errorf("UserID (%s) must equal ImpersonatedBy (%s) — actions attribute to the operator", claims.UserID, claims.ImpersonatedBy)
	}
}

func TestImpersonateNonActiveTenantIs409(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{getTenantStatus: func(id uuid.UUID) (string, error) { return "suspended", nil }}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (reactivate before impersonating)", rec.Code)
	}
}

func TestImpersonateNestedIs403(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil }}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	claims := c.Get("user").(*models.JWTCustomClaims)
	claims.ImpersonatedBy = uuid.New().String() // caller is already impersonating
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (no nested impersonation)", rec.Code)
	}
}
```


- [ ] **Step 2: Verify fail** — `go test ./internal/handler/ -run TestImpersonate -v` → compile error (`ImpersonateTenant` undefined).

- [ ] **Step 3: Implement**

`models/auth.go`:

```go
type JWTCustomClaims struct {
	UserID   string `json:"user_id"`
	TenantID string `json:"tenant_id"`
	Role     string `json:"role"`
	// ImpersonatedBy is set only on operator-minted impersonation tokens:
	// the super admin's user id. Its presence marks the session for audit.
	ImpersonatedBy string `json:"imp_by,omitempty"`
	jwt.RegisteredClaims
}
```

`auth.go` (next to `generateTokenForTenant`):

```go
// generateImpersonationToken mints a short-lived token that acts inside the
// target tenant with admin role but attributes every action to the operator:
// UserID and ImpersonatedBy are both the super admin's id.
func generateImpersonationToken(superAdminID, tenantID string) (string, time.Time, error) {
	expiresAt := time.Now().Add(30 * time.Minute)
	claims := &models.JWTCustomClaims{
		UserID:         superAdminID,
		TenantID:       tenantID,
		Role:           "admin",
		ImpersonatedBy: superAdminID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	secret := config.JWTSecret()
	if secret == "" {
		return "", time.Time{}, fmt.Errorf("JWT_SECRET environment variable not set")
	}
	signed, err := token.SignedString([]byte(secret))
	return signed, expiresAt, err
}
```

`super_admin.go`:

```go
// ImpersonateTenant mints a 30-minute support session inside the target
// tenant. Requires an active tenant; refuses nested impersonation.
func (h *Handler) ImpersonateTenant(c echo.Context) error {
	claims, err := claimsFromContext(c) // Task 6 helper; until it lands use the unchecked assertion the file already uses
	if err != nil {
		return writeErr(c, err)
	}
	if claims.ImpersonatedBy != "" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "nested impersonation is not allowed"})
	}
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}
	status, err := h.Store.GetTenantStatus(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load tenant"})
	}
	if status == "" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}
	if status != "active" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "tenant is " + status + " — reactivate before impersonating"})
	}
	token, expiresAt, err := generateImpersonationToken(claims.UserID, tenantID.String())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mint impersonation token"})
	}
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "impersonate_tenant", "tenant", tenantID, map[string]interface{}{"expires_at": expiresAt}, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":      token,
		"expires_at": expiresAt,
		"tenant_id":  tenantID,
	})
}
```

Ordering note vs Task 6: if Task 6 hasn't landed yet, write `claims := c.Get("user").(*models.JWTCustomClaims)` here and let Task 6's sweep convert it. Do NOT block on the helper.

Route in `handler.go` (inside the saas super-admin block, next to the lifecycle routes):

```go
		superAdmin.POST("/tenants/:id/impersonate", h.ImpersonateTenant)
```

- [ ] **Step 4: Gates + commit**

```bash
git add backend/internal/models/auth.go backend/internal/handler/
git commit -m "feat(backend): impersonation mint endpoint — 30-min imp_by tokens, audited (P1.5)"
```

---

### Task 4: Impersonated-mutation audit middleware (P1.5b)

**Files:**
- Create: `backend/internal/middleware/impersonation_audit.go`, `backend/internal/middleware/impersonation_audit_test.go`
- Modify: `backend/internal/handler/handler.go` (mount after TenantGate)

**Interfaces:**
- Consumes: `claims.ImpersonatedBy` (Task 3), `LogAdminAction` (Task 1).
- Produces: `middleware.ImpersonationAudit(s store.Store) echo.MiddlewareFunc` — for POST/PUT/PATCH/DELETE with `imp_by` set: best-effort `LogAdminAction(impByID, "impersonated_request", "tenant", tenantID, {"method":..., "path":...}, ip, ua)` BEFORE the handler runs (log even if the handler later fails); GETs and non-impersonated requests untouched.

- [ ] **Step 1: Failing tests**

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

type impAuditFakeStore struct {
	store.Store
	logged []string
}

func (f *impAuditFakeStore) LogAdminAction(_ context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
	f.logged = append(f.logged, action)
	return nil
}

func impAuditRequest(t *testing.T, fs *impAuditFakeStore, method, impBy string) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(method, "/api/events", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin",
		ImpersonatedBy: impBy,
	})
	h := ImpersonationAudit(fs)(func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	if err := h(c); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
}

func TestImpersonatedMutationIsAudited(t *testing.T) {
	fs := &impAuditFakeStore{}
	impAuditRequest(t, fs, http.MethodPost, uuid.New().String())
	if len(fs.logged) != 1 || fs.logged[0] != "impersonated_request" {
		t.Fatalf("logged = %v, want one impersonated_request", fs.logged)
	}
}

func TestImpersonatedReadIsNotAudited(t *testing.T) {
	fs := &impAuditFakeStore{}
	impAuditRequest(t, fs, http.MethodGet, uuid.New().String())
	if len(fs.logged) != 0 {
		t.Fatalf("GET must not be audited, logged = %v", fs.logged)
	}
}

func TestNonImpersonatedMutationIsNotAudited(t *testing.T) {
	fs := &impAuditFakeStore{}
	impAuditRequest(t, fs, http.MethodDelete, "")
	if len(fs.logged) != 0 {
		t.Fatalf("non-impersonated must not be audited, logged = %v", fs.logged)
	}
}
```

- [ ] **Step 2: Verify fail** — compile error, `ImpersonationAudit` undefined.

- [ ] **Step 3: Implement**

```go
package middleware

import (
	"log"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// ImpersonationAudit writes an audit row for every mutating request made
// under an impersonation token (imp_by claim), attributing it to the
// operator. Best-effort: an audit failure never blocks the request — the
// mint event was already logged, and availability wins here.
func ImpersonationAudit(s store.Store) echo.MiddlewareFunc {
	mutating := map[string]bool{"POST": true, "PUT": true, "PATCH": true, "DELETE": true}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get("user").(*models.JWTCustomClaims)
			if ok && claims != nil && claims.ImpersonatedBy != "" && mutating[c.Request().Method] {
				adminID, err := uuid.Parse(claims.ImpersonatedBy)
				tenantID, terr := uuid.Parse(claims.TenantID)
				if err == nil && terr == nil {
					if err := s.LogAdminAction(c.Request().Context(), adminID, "impersonated_request", "tenant", tenantID, map[string]interface{}{
						"method": c.Request().Method,
						"path":   c.Request().URL.Path,
					}, c.RealIP(), c.Request().UserAgent()); err != nil {
						log.Printf("impersonation audit failed (%s %s): %v", c.Request().Method, c.Request().URL.Path, err)
					}
				}
			}
			return next(c)
		}
	}
}
```

Mount in `handler.go` directly after the TenantGate line:

```go
	api.Use(middleware.ImpersonationAudit(h.Store))
```

- [ ] **Step 4: Gates + commit**

```bash
git add backend/internal/middleware/ backend/internal/handler/handler.go
git commit -m "feat(backend): audit every impersonated mutation (P1.5)"
```

---

### Task 5: Platform analytics (P1.6)

**Files:**
- Modify: `backend/internal/models/models.go` (analytics structs), `backend/internal/store/interface.go`, `backend/internal/store/pg_store.go`, `backend/internal/handler/super_admin.go` (replace the stub)
- Create: `backend/internal/handler/super_admin_analytics_test.go`

**Interfaces:**
- Produces:

```go
type TimeCount struct {
	Period string `json:"period"` // YYYY-MM-DD (day) or ISO week start date
	Count  int    `json:"count"`
}

type PlanCount struct {
	Plan  string `json:"plan"` // plan slug; "none" when tenant has no subscription
	Count int    `json:"count"`
}

type PlatformAnalytics struct {
	TenantsByStatus map[string]int `json:"tenants_by_status"`
	TenantsByPlan   []PlanCount    `json:"tenants_by_plan"`
	SignupsByWeek   []TimeCount    `json:"signups_by_week"`   // last 8 weeks
	ActiveEvents    int            `json:"active_events"`     // running today
	CheckinsByDay   []TimeCount    `json:"checkins_by_day"`   // last 14 days
	TotalTenants    int            `json:"total_tenants"`
	PaidTenants     int            `json:"paid_tenants"`      // active sub on a plan with price_monthly > 0
	PaidConversion  float64        `json:"paid_conversion"`   // paid / total, 0 when no tenants
}
```

  - `Store.GetPlatformAnalytics(ctx context.Context) (*models.PlatformAnalytics, error)`.
- Consumes: schema facts — `tenants.status/created_at`, `subscriptions` join `subscription_plans (slug, price_monthly)`, `events.start_date/end_date/deleted_at`, `attendees.checked_in_at` (exists since 000001).

- [ ] **Step 1: Failing handler test**

```go
package handler

import (
	"net/http"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/labstack/echo/v4"
)

func TestSystemAnalyticsReturnsAggregates(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getPlatformAnalytics: func() (*models.PlatformAnalytics, error) {
			return &models.PlatformAnalytics{
				TenantsByStatus: map[string]int{"active": 3, "suspended": 1},
				TotalTenants:    4,
				PaidTenants:     1,
				PaidConversion:  0.25,
			}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", "", "admin")
	if err := h.GetSystemAnalytics(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tenants_by_status"`) {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "coming soon") {
		t.Fatal("stub response still present")
	}
}
```

fakeStore addition:

```go
	getPlatformAnalytics func() (*models.PlatformAnalytics, error)
```

```go
func (f *fakeStore) GetPlatformAnalytics(_ context.Context) (*models.PlatformAnalytics, error) {
	return f.getPlatformAnalytics()
}
```

- [ ] **Step 2: Verify fail**, then implement the store method in `pg_store.go`:

```go
// GetPlatformAnalytics aggregates operator-facing platform metrics. All
// queries are cheap index scans/aggregates over small operator tables;
// callers are super-admin only.
func (s *PGStore) GetPlatformAnalytics(ctx context.Context) (*models.PlatformAnalytics, error) {
	a := &models.PlatformAnalytics{TenantsByStatus: map[string]int{}}

	rows, err := s.db.Query(ctx, `SELECT status, COUNT(*) FROM tenants GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("tenants by status: %w", err)
	}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			rows.Close()
			return nil, err
		}
		a.TenantsByStatus[status] = count
		a.TotalTenants += count
	}
	rows.Close()

	rows, err = s.db.Query(ctx, `
		SELECT COALESCE(p.slug, 'none'), COUNT(*)
		FROM tenants t
		LEFT JOIN subscriptions s ON s.tenant_id = t.id
		LEFT JOIN subscription_plans p ON p.id = s.plan_id
		GROUP BY 1 ORDER BY 2 DESC`)
	if err != nil {
		return nil, fmt.Errorf("tenants by plan: %w", err)
	}
	for rows.Next() {
		var pc models.PlanCount
		if err := rows.Scan(&pc.Plan, &pc.Count); err != nil {
			rows.Close()
			return nil, err
		}
		a.TenantsByPlan = append(a.TenantsByPlan, pc)
	}
	rows.Close()

	rows, err = s.db.Query(ctx, `
		SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD'), COUNT(*)
		FROM tenants
		WHERE created_at >= date_trunc('week', NOW()) - INTERVAL '7 weeks'
		GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("signups by week: %w", err)
	}
	for rows.Next() {
		var tc models.TimeCount
		if err := rows.Scan(&tc.Period, &tc.Count); err != nil {
			rows.Close()
			return nil, err
		}
		a.SignupsByWeek = append(a.SignupsByWeek, tc)
	}
	rows.Close()

	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM events
		WHERE deleted_at IS NULL
		  AND (start_date IS NULL OR start_date <= NOW())
		  AND (end_date IS NULL OR end_date >= NOW())`).Scan(&a.ActiveEvents); err != nil {
		return nil, fmt.Errorf("active events: %w", err)
	}

	rows, err = s.db.Query(ctx, `
		SELECT to_char(date_trunc('day', checked_in_at), 'YYYY-MM-DD'), COUNT(*)
		FROM attendees
		WHERE checked_in_at >= NOW() - INTERVAL '14 days'
		GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("checkins by day: %w", err)
	}
	for rows.Next() {
		var tc models.TimeCount
		if err := rows.Scan(&tc.Period, &tc.Count); err != nil {
			rows.Close()
			return nil, err
		}
		a.CheckinsByDay = append(a.CheckinsByDay, tc)
	}
	rows.Close()

	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT t.id)
		FROM tenants t
		JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
		JOIN subscription_plans p ON p.id = s.plan_id AND p.price_monthly > 0`).Scan(&a.PaidTenants); err != nil {
		return nil, fmt.Errorf("paid tenants: %w", err)
	}
	if a.TotalTenants > 0 {
		a.PaidConversion = float64(a.PaidTenants) / float64(a.TotalTenants)
	}
	return a, nil
}
```

Handler replaces the stub:

```go
// GetSystemAnalytics returns operator-facing platform aggregates (P1.6).
func (h *Handler) GetSystemAnalytics(c echo.Context) error {
	analytics, err := h.Store.GetPlatformAnalytics(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to compute analytics"})
	}
	return c.JSON(http.StatusOK, analytics)
}
```

Verify the column names used against migrations 000001/000003 before finalizing (`events.start_date/end_date/deleted_at`, `attendees.checked_in_at`) — adjust to the real schema if they differ, and note it in the report.

- [ ] **Step 3: Gates + commit**

```bash
git add backend/internal/models/models.go backend/internal/store/ backend/internal/handler/
git commit -m "feat(backend): real platform analytics — tenants/plans/signups/checkins/conversion (P1.6)"
```

---

### Task 6: Claims-assertion sweep (hygiene)

**Files:**
- Modify: `backend/internal/handler/authz.go` (helper), then every file with `c.Get("user").(*models.JWTCustomClaims)` unchecked: `super_admin.go` (5+, incl. new impersonation sites), `events.go` (2), `attendees.go` (1), `users.go` (4), `zones.go` (3), `auth.go` (check), `sync.go` (check)

**Interfaces:**
- Produces: `claimsFromContext(c echo.Context) (*models.JWTCustomClaims, error)` in authz.go — 401 `*httpError` on missing/mistyped claims; `tenantIDFromContext` refactored to use it. All handler claim reads go through it (grep proves zero unchecked assertions remain).

- [ ] **Step 1: Helper**

```go
// claimsFromContext returns the JWT claims set by middleware.JWT, or a 401
// httpError — handlers must never panic on a missing/mistyped context value.
func claimsFromContext(c echo.Context) (*models.JWTCustomClaims, error) {
	claims, ok := c.Get("user").(*models.JWTCustomClaims)
	if !ok || claims == nil {
		return nil, newHTTPError(http.StatusUnauthorized, "Invalid token")
	}
	return claims, nil
}
```

Refactor `tenantIDFromContext` to call it. Then replace every unchecked assertion:

```go
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
```

(adapt the local variable name each site already uses — `user`, `currentUser`, or `claims`). Where a site only needs the tenant id, prefer the existing `tenantIDFromContext`.

- [ ] **Step 2: Grep gate**

`grep -rn 'c.Get("user").(\*models.JWTCustomClaims)' internal/handler/ | grep -v '_test.go' | grep -v 'claimsFromContext'` → the ONLY hit is inside `claimsFromContext` itself.

- [ ] **Step 3: Full gates + commit**

```bash
git add backend/internal/handler/
git commit -m "refactor(backend): checked claims access everywhere — no panics on missing context (hygiene)"
```

---

### Task 7: Gate cache bound + SQL aliases + dead-code removal (hygiene)

**Files:**
- Modify: `backend/internal/middleware/tenant_gate.go` (+ test), `backend/internal/store/pg_store.go` (`GetAllTenants` aliases; remove `AddUserToTenant`, `CreateSubscription` impls), `backend/internal/store/interface.go` (remove the two methods), `backend/internal/handler/testsupport_test.go` (remove `addUserToTenant`, `createSubscription` fields/methods)

**Interfaces:**
- Consumes: verified-dead status of `AddUserToTenant` and `CreateSubscription` — RE-VERIFY with word-boundary greps before deleting: `grep -rn '\.AddUserToTenant(' backend/ --include='*.go'` and `grep -rn '\.CreateSubscription(' backend/ --include='*.go'` (the latter must not match `CreateSubscriptionPlan` — check word boundary). If ANY non-test caller exists, keep that method and say so in the report.
- Produces: gate cache bounded; no behavior change elsewhere.

- [ ] **Step 1: Cache sweep**

In `tenant_gate.go`, extract and call a sweep inside the existing write lock:

```go
// sweepExpiredLocked removes expired entries; callers hold the write lock.
// Bounded work: runs only when the cache exceeds maxGateCacheEntries, which
// caps memory at roughly the live-tenant cardinality.
const maxGateCacheEntries = 1024

func sweepExpiredLocked(cache map[string]gateEntry, now time.Time) {
	for k, v := range cache {
		if now.After(v.expires) {
			delete(cache, k)
		}
	}
}
```

and in the write path:

```go
			if ttl > 0 {
				mu.Lock()
				if len(cache) >= maxGateCacheEntries {
					sweepExpiredLocked(cache, time.Now())
				}
				cache[claims.TenantID] = gateEntry{blocked: blocked, expires: time.Now().Add(ttl)}
				mu.Unlock()
			}
```

Unit test for the sweep function directly:

```go
func TestSweepExpiredLocked(t *testing.T) {
	now := time.Now()
	cache := map[string]gateEntry{
		"live":    {expires: now.Add(time.Minute)},
		"expired": {expires: now.Add(-time.Minute)},
	}
	sweepExpiredLocked(cache, now)
	if _, ok := cache["expired"]; ok {
		t.Error("expired entry survived sweep")
	}
	if _, ok := cache["live"]; !ok {
		t.Error("live entry was swept")
	}
}
```

- [ ] **Step 2: SQL aliases**

In `GetAllTenants`'s SELECT, alias the two ambiguous columns: `t.status AS tenant_status` and `s.status AS subscription_status` (scan stays positional and unchanged — this is readability/refactor-safety only).

- [ ] **Step 3: Dead-code removal (after the re-verification greps)**

Remove from `interface.go`: `AddUserToTenant`, `CreateSubscription`. Remove both PGStore implementations. Remove fakeStore fields `addUserToTenant`, `createSubscription` and their methods. Compiler + full suite prove nothing referenced them.

- [ ] **Step 4: Full gates + commit**

```bash
git add backend/internal/middleware/ backend/internal/store/ backend/internal/handler/testsupport_test.go
git commit -m "refactor(backend): bound TenantGate cache; alias status columns; drop dead store methods (hygiene)"
```

---

## Final Verification (whole batch)

- [ ] `cd backend && go build ./... && go test ./... && go vet ./... && golangci-lint run ./internal/... && gofmt -l .` — all green/empty.
- [ ] Live e2e (docker dev DB, saas mode): register operator → `create_super_admin` CLI → register victim tenant → operator `POST /api/super-admin/tenants/<victim>/impersonate` → 200 with token → use the imp token to `POST /api/events` inside the victim tenant → 201 → `GET /api/super-admin/audit-log?action=impersonated_request` (operator token) shows the row with non-null ip/user_agent; `?action=impersonate_tenant` shows the mint. Imp token calling the impersonate endpoint again → 403 (nested).
- [ ] `GET /api/super-admin/analytics` returns real aggregates (non-"coming soon"; tenants_by_status matches psql counts).
- [ ] Impersonating a suspended tenant → 409.
- [ ] Re-read roadmap "Accept" lines for P1.5, P1.6, P1.7 — all satisfied (P1.5's web banner is explicitly part of P1.8's UI batch — state this in the PR).

## Out of Scope (this batch)

P1.8 tenant-admin UI (next batch — consumes these endpoints; includes the impersonation banner); mobile/kiosk `tenant_suspended` handling; audit-log date-range/tenant filters beyond `action` (P1.8 territory); payment provider; Phase 2 packaging.
