# Platform Console Redesign — Batch 1 (Foundation + Shell + Overview + Tenants List) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the super-admin ("Platform Console") shell, Dashboard, and Tenants list to match the canonical design in Claude Design project `165a9ba5-4bb1-4ede-9048-546ccb1742af`, file `Idento Console.dc.html` (dark top-chrome shell, 4-way status system, real usage meters), and stand up the shared infrastructure (design tokens, meter/queue utilities, frontend test runner) the rest of the redesign (Batch 2: Tenant Detail, Suspend/Archive dialogs, Impersonation ceremony, Audit log, Plans editor) will build on.

**Architecture:** Visual/structural reskin of already-shipped, working features — no new product surfaces, no invoicing/billing subsystem (explicitly deferred by the user to its own future initiative). One small, targeted backend addition (optional `reason` on lifecycle/impersonation actions, persisted into the existing audit `changes` JSONB) is included because the shipped design's required "Reason" fields cannot be honest UI without it — everything else is frontend-only, reusing existing endpoints and existing response fields that are already returned but currently unused (`last_activity`, audit `total`/`offset`, `trial_end_date`, `next_billing_date`).

**Tech Stack:** Go 1.x / Echo v4 / pgx v5 (backend, Task 1 only); React 18.3.1 + Vite + TypeScript + Tailwind v4 (CSS-first, HSL CSS vars) + shadcn/radix primitives + react-i18next + react-router-dom v7 (frontend). New dev dependency: `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` (Task 2 — no test runner exists in `web/` today).

## Global Constraints

- **HARD RULE (repeat verbatim in every task's implementer brief):** never modify, weaken, or bypass authentication/authorization middleware, tenant isolation checks, or `ConfirmActionDialog`'s fail-closed confirm-text lock logic (`requireText = confirmText !== undefined; locked = requireText && (confirmText === '' || typed !== confirmText)`) to make a test pass. If a test's expectation conflicts with real security behavior, report BLOCKED instead of changing the security code.
- **No invoicing/billing subsystem.** Do not add Invoices, a Billing tab, Document templates, a Service catalog, or PDF generation in this plan — out of scope by explicit user decision.
- **No fabricated data.** Every number, chip, or copy string rendered must come from a real API field already returned today, or from a field added in Task 1. Do not invent "live" telemetry (e.g. per-tenant kiosk/scanner online status) that no endpoint provides — Batch 2's Suspend dialog will use only `users_count`/`events_count` from the existing tenant-stats endpoint, not invented live consequences.
- **Client-side only where the backend has no matching capability.** `GET /api/super-admin/tenants` has no query params (no filter/sort/paginate) — filtering, saved-queue chips, and pagination in the Tenants list are computed client-side over the full fetched list. Do not add server-side pagination in this plan.
- **i18n convention:** flat camelCase keys, added to both `en` and `ru` blocks in `web/src/i18n.ts` in the same relative position (near the `// Super Admin` or `// Analytics` comment section), keeping the two blocks in parallel key order. Reuse the two established prefix families where applicable: `tenantStatus_<status>`, `lifecycle_<verb>_<field>`.
- **Design token source of truth:** brand green `#00935e` already matches the existing `--primary: 152 100% 29%` HSL var almost exactly — reuse `--primary`/`--accent`/`--destructive` rather than introducing parallel green tokens. Net-new tokens are only for concepts the current system has no analog for: the dark top-chrome surface, and the 4-way status-quad (the current system only has 3 semantic colors: primary/muted/destructive, no distinct "trial blue").
- Every frontend task ends with `cd web && npx tsc -b --noEmit && npx eslint . && npx vitest run` passing, in addition to its own test file.

---

### Task 1: Backend — optional `reason` on lifecycle transitions and impersonation, persisted to audit log

**Files:**
- Modify: `backend/internal/handler/super_admin.go:391-421` (`setTenantStatus`), `backend/internal/handler/super_admin.go:429-468` (`ImpersonateTenant`)
- Test: `backend/internal/handler/super_admin_test.go` (create if it doesn't exist — check first with `ls backend/internal/handler/super_admin_test.go`; if it exists, add to it following its existing `fakeStore`-based pattern)

**Interfaces:**
- Consumes: existing `h.Store.LogAdminAction(ctx, adminID, action, targetType, targetID, changes map[string]interface{}, ip, userAgent string) error`, existing `tenantTransitions` map, existing `generateImpersonationToken`.
- Produces: `setTenantStatus` and `ImpersonateTenant` now read an optional JSON body `{"reason": "..."}` and include `"reason"` in the `changes` map passed to `LogAdminAction` (empty string omitted, not stored as `""`). No change to response bodies or status codes. Frontend tasks in Batch 2 will send this field; this task must not require it (a request with no body, or `{}`, must behave exactly as today — Batch 1's Dashboard "Reactivate" quick-action button will call this endpoint with no body).

- [ ] **Step 1: Check for an existing test file**

Run: `ls backend/internal/handler/super_admin_test.go`

If it doesn't exist, create it with this package header (matching this codebase's `fakeStore` convention already used in `testsupport_test.go`):

```go
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)
```

- [ ] **Step 2: Write the failing tests**

Add to `backend/internal/handler/super_admin_test.go`:

```go
func TestSetTenantStatus_ReasonPersistedToAuditChanges(t *testing.T) {
	e := echo.New()
	fs := newFakeStore()
	tenantID := uuid.New()
	fs.tenants[tenantID] = "active"
	adminID := uuid.New()
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]string{"reason": "Spring Summit 2026, approved by JR"})
	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/suspend", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("claims", testClaims(adminID.String()))

	if err := h.SuspendTenant(c); err != nil {
		t.Fatalf("SuspendTenant returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if fs.lastAuditChanges["reason"] != "Spring Summit 2026, approved by JR" {
		t.Fatalf("expected reason in audit changes, got %#v", fs.lastAuditChanges)
	}
	if fs.lastAuditChanges["from"] != "active" || fs.lastAuditChanges["to"] != "suspended" {
		t.Fatalf("expected from/to preserved alongside reason, got %#v", fs.lastAuditChanges)
	}
}

func TestSetTenantStatus_NoBodyStillWorks(t *testing.T) {
	e := echo.New()
	fs := newFakeStore()
	tenantID := uuid.New()
	fs.tenants[tenantID] = "suspended"
	adminID := uuid.New()
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/reactivate", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("claims", testClaims(adminID.String()))

	if err := h.ReactivateTenant(c); err != nil {
		t.Fatalf("ReactivateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, hasReason := fs.lastAuditChanges["reason"]; hasReason {
		t.Fatalf("expected no reason key when body omits it, got %#v", fs.lastAuditChanges)
	}
}

func TestImpersonateTenant_ReasonPersistedToAuditChanges(t *testing.T) {
	e := echo.New()
	fs := newFakeStore()
	tenantID := uuid.New()
	fs.tenants[tenantID] = "active"
	adminID := uuid.New()
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]string{"reason": "Reproduce badge-print bug for support ticket #4821"})
	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/impersonate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("claims", testClaims(adminID.String()))

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("ImpersonateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if fs.lastAuditChanges["reason"] != "Reproduce badge-print bug for support ticket #4821" {
		t.Fatalf("expected reason in audit changes, got %#v", fs.lastAuditChanges)
	}
}
```

Check `fakeStore` (in `backend/internal/handler/testsupport_test.go`) already has a `tenants map[uuid.UUID]string` (status by ID) and a way to capture the last `LogAdminAction` call. Search first:

Run: `grep -n "lastAuditChanges\|func (f \*fakeStore) LogAdminAction\|tenants " backend/internal/handler/testsupport_test.go`

If `lastAuditChanges` does not exist on `fakeStore`, add a field `lastAuditChanges map[string]interface{}` to the `fakeStore` struct and set it inside its `LogAdminAction` method:

```go
func (f *fakeStore) LogAdminAction(ctx context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes map[string]interface{}, ip, userAgent string) error {
	f.lastAuditChanges = changes
	return nil
}
```

If `testClaims(userID string)` doesn't already exist as a test helper, add it:

```go
func testClaims(userID string) *auth.Claims {
	return &auth.Claims{UserID: userID, IsSuperAdmin: true}
}
```

(Check the real import path/package for `Claims` first — run `grep -n "claimsFromContext\|type Claims struct" backend/internal/handler/*.go backend/internal/auth/*.go` and match its actual package and field names exactly; do not guess the field name if `IsSuperAdmin` doesn't exist — use whatever field the real `Claims` struct uses to satisfy `claimsFromContext`'s super-admin check for this route.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/ -run 'TestSetTenantStatus_ReasonPersistedToAuditChanges|TestSetTenantStatus_NoBodyStillWorks|TestImpersonateTenant_ReasonPersistedToAuditChanges' -v`
Expected: FAIL (reason not read/persisted yet, and/or compile error if `lastAuditChanges` didn't exist — fix compile errors first, then confirm the assertions themselves fail).

- [ ] **Step 4: Implement — read optional reason body in `setTenantStatus`**

In `backend/internal/handler/super_admin.go`, modify `setTenantStatus` (currently lines 391-421):

```go
func (h *Handler) setTenantStatus(c echo.Context, action string) error {
	tr := tenantTransitions[action]
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.Bind(&body) // optional body; malformed/absent JSON leaves body.Reason == ""
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
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	changes := map[string]interface{}{"from": current, "to": tr.to}
	if body.Reason != "" {
		changes["reason"] = body.Reason
	}
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, action+"_tenant", "tenant", tenantID, changes, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusOK, map[string]string{"status": tr.to})
}
```

- [ ] **Step 5: Implement — read optional reason body in `ImpersonateTenant`**

In `backend/internal/handler/super_admin.go`, modify `ImpersonateTenant` (currently lines 429-468) — add the body struct and bind right after the tenant-ID parse, and include it in the existing `LogAdminAction` call:

```go
func (h *Handler) ImpersonateTenant(c echo.Context) error {
	claims, err := claimsFromContext(c)
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
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.Bind(&body)
	status, err := h.Store.GetTenantStatus(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load tenant"})
	}
	if status == "" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}
	if status != "active" {
		hint := "reactivate before impersonating"
		if status == "archived" {
			hint = "archived tenants cannot be impersonated"
		}
		return c.JSON(http.StatusConflict, map[string]string{"error": "tenant is " + status + " — " + hint})
	}
	token, expiresAt, err := generateImpersonationToken(claims.UserID, tenantID.String())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mint impersonation token"})
	}
	adminID := uuid.MustParse(claims.UserID)
	changes := map[string]interface{}{"expires_at": expiresAt}
	if body.Reason != "" {
		changes["reason"] = body.Reason
	}
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "impersonate_tenant", "tenant", tenantID, changes, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":      token,
		"expires_at": expiresAt,
		"tenant_id":  tenantID,
	})
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/ -run 'TestSetTenantStatus_ReasonPersistedToAuditChanges|TestSetTenantStatus_NoBodyStillWorks|TestImpersonateTenant_ReasonPersistedToAuditChanges' -v`
Expected: PASS (all 3 tests)

Also run the full handler suite to confirm no regression: `cd backend && go test ./internal/handler/... -v`
Expected: PASS (all existing tests still pass — in particular any existing suspend/reactivate/archive/impersonate tests must still pass with a nil/empty body, since `c.Bind` on an empty request body is a no-op, not an error, in Echo).

- [ ] **Step 7: Lint and commit**

Run: `cd backend && gofmt -l . && golangci-lint run ./...`
Expected: no output from gofmt (clean), golangci-lint passes.

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): optional reason on lifecycle + impersonation, persisted to audit log"
```

---

### Task 2: Frontend test infrastructure (vitest + Testing Library)

**Files:**
- Create: `web/vitest.config.ts`, `web/src/test/setup.ts`
- Modify: `web/package.json` (add `test` script + devDependencies)
- Test: `web/src/lib/__tests__/smoke.test.ts` (deleted at the end of this task once Task 3 has a real test — see Step 5)

**Interfaces:**
- Produces: `npm test` (alias for `vitest run`) works from `web/`; `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` available to every subsequent frontend task in this plan.

- [ ] **Step 1: Install dependencies**

Run: `cd web && npm install --save-dev vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 jsdom@^25`

- [ ] **Step 2: Add the test script to `package.json`**

Modify `web/package.json`'s `"scripts"` block (currently):
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "preview": "vite preview"
  },
```
to:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Create the vitest config**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

(Confirm the `@` alias target matches `web/vite.config.ts`'s existing alias first — run `cat web/vite.config.ts` and match its `resolve.alias` exactly; adjust the path above if it differs from `./src`.)

- [ ] **Step 4: Create the setup file**

Create `web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write a smoke test to prove the runner works, run it, then delete it**

Create `web/src/lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd web && npm test`
Expected: PASS, 1 test.

Delete the smoke test — it has no further purpose once Task 3 lands a real test in the same directory:

Run: `rm web/src/lib/__tests__/smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/test/setup.ts
git commit -m "chore(web): add vitest + Testing Library test infrastructure"
```

---

### Task 3: Shared meter utility (`web/src/lib/meters.ts`)

**Files:**
- Create: `web/src/lib/meters.ts`
- Test: `web/src/lib/__tests__/meters.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MeterTone = 'ok' | 'warn' | 'over' | 'unlimited';
  export function meterTone(count: number, limit: number): MeterTone;
  export function meterPercent(count: number, limit: number): number; // 0-100, clamped; unlimited (-1) returns 0
  export function meterToneClass(tone: MeterTone): string; // Tailwind text/bg color classes
  ```
  Consumed by: Task 9 (Tenants list "Attendees vs limit" column), Task 10 (Dashboard "Over limit" queue), and Batch 2's Tenant Detail Summary meters.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/__tests__/meters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { meterTone, meterPercent, meterToneClass } from '../meters';

describe('meterTone', () => {
  it('returns unlimited when limit is -1', () => {
    expect(meterTone(5000, -1)).toBe('unlimited');
  });
  it('returns ok when under 80%', () => {
    expect(meterTone(79, 100)).toBe('ok');
  });
  it('returns warn at exactly 80%', () => {
    expect(meterTone(80, 100)).toBe('warn');
  });
  it('returns warn between 80% and 100%', () => {
    expect(meterTone(95, 100)).toBe('warn');
  });
  it('returns over at exactly 100%', () => {
    expect(meterTone(100, 100)).toBe('over');
  });
  it('returns over above 100%', () => {
    expect(meterTone(122, 100)).toBe('over');
  });
  it('treats a zero limit as unlimited-safe (no divide by zero, returns over only if count > 0)', () => {
    expect(meterTone(0, 0)).toBe('ok');
    expect(meterTone(1, 0)).toBe('over');
  });
});

describe('meterPercent', () => {
  it('computes a clamped 0-100 percent', () => {
    expect(meterPercent(50, 100)).toBe(50);
    expect(meterPercent(150, 100)).toBe(100);
    expect(meterPercent(0, 100)).toBe(0);
  });
  it('returns 0 for unlimited (-1) limits', () => {
    expect(meterPercent(5000, -1)).toBe(0);
  });
});

describe('meterToneClass', () => {
  it('maps each tone to a distinct class string', () => {
    expect(meterToneClass('ok')).toContain('primary');
    expect(meterToneClass('warn')).toMatch(/amber|yellow/);
    expect(meterToneClass('over')).toBe('text-destructive');
    expect(meterToneClass('unlimited')).toContain('muted');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/__tests__/meters.test.ts`
Expected: FAIL with "Cannot find module '../meters'"

- [ ] **Step 3: Implement**

Create `web/src/lib/meters.ts`:

```ts
export type MeterTone = 'ok' | 'warn' | 'over' | 'unlimited';

/** Limits use the codebase-wide convention: -1 means unlimited (see backend/internal/store/seed.go). */
const UNLIMITED = -1;

export function meterTone(count: number, limit: number): MeterTone {
  if (limit === UNLIMITED) return 'unlimited';
  if (limit === 0) return count > 0 ? 'over' : 'ok';
  const pct = (count / limit) * 100;
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'warn';
  return 'ok';
}

export function meterPercent(count: number, limit: number): number {
  if (limit === UNLIMITED || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((count / limit) * 100)));
}

export function meterToneClass(tone: MeterTone): string {
  switch (tone) {
    case 'over':
      return 'text-destructive';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400';
    case 'unlimited':
      return 'text-muted-foreground';
    case 'ok':
    default:
      return 'text-primary';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/__tests__/meters.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/lib/meters.ts src/lib/__tests__/meters.test.ts`

```bash
git add web/src/lib/meters.ts web/src/lib/__tests__/meters.test.ts
git commit -m "feat(web): shared meter tone/percent utility for usage-vs-limit displays"
```

---

### Task 4: `StatusBadge` 4-way extension (add `trial`)

**Files:**
- Modify: `web/src/components/StatusBadge.tsx`, `web/src/i18n.ts`
- Test: `web/src/components/__tests__/StatusBadge.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StatusBadge` renders a distinct visual for `status="trial"` (previously fell through to a bare outline badge showing the literal string `"trial"`). Component signature (`{ status?: string }`) is unchanged — Batch 2 tasks can pass `"trial"` without further changes.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/StatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';
import '../../i18n';

describe('StatusBadge', () => {
  it('renders the active status with the translated label', () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a distinct trial status, not the raw fallback string', () => {
    render(<StatusBadge status="trial" />);
    const badge = screen.getByText('Trial');
    expect(badge).toBeInTheDocument();
    expect(badge.className).not.toBe('');
  });

  it('renders suspended and archived with their existing classes', () => {
    const { rerender } = render(<StatusBadge status="suspended" />);
    expect(screen.getByText('Suspended').className).toContain('amber');
    rerender(<StatusBadge status="archived" />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('defaults to active when status is undefined', () => {
    render(<StatusBadge />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/StatusBadge.test.tsx`
Expected: FAIL on the "renders a distinct trial status" case — today `t('tenantStatus_trial', 'trial')` falls back to the literal string `"trial"` (lowercase), not `"Trial"`, and the className check fails since `styles['trial']` is `undefined` so `Badge` renders with `variant="outline"` and `className=""`.

- [ ] **Step 3: Add i18n keys**

In `web/src/i18n.ts`, find the existing block (around line 733, English resources):
```ts
  tenantStatus_active: 'Active',
  tenantStatus_suspended: 'Suspended',
  tenantStatus_archived: 'Archived',
```
Change to:
```ts
  tenantStatus_active: 'Active',
  tenantStatus_trial: 'Trial',
  tenantStatus_suspended: 'Suspended',
  tenantStatus_archived: 'Archived',
```

Find the matching Russian block (around line 1594):
```ts
  tenantStatus_active: 'Активен',
  tenantStatus_suspended: 'Приостановлен',
  tenantStatus_archived: 'В архиве',
```
Change to:
```ts
  tenantStatus_active: 'Активен',
  tenantStatus_trial: 'Пробный период',
  tenantStatus_suspended: 'Приостановлен',
  tenantStatus_archived: 'В архиве',
```

- [ ] **Step 4: Implement the 4-way status map**

Modify `web/src/components/StatusBadge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

const styles: Record<string, string> = {
  active: 'bg-primary text-primary-foreground',
  trial: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  suspended: 'bg-amber-500 text-black',
  archived: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation();
  const s = status || 'active';
  return (
    <Badge variant={styles[s] ? undefined : 'outline'} className={styles[s] ?? ''}>
      {t(`tenantStatus_${s}`, s)}
    </Badge>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/StatusBadge.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/StatusBadge.tsx src/i18n.ts src/components/__tests__/StatusBadge.test.tsx`

```bash
git add web/src/components/StatusBadge.tsx web/src/i18n.ts web/src/components/__tests__/StatusBadge.test.tsx
git commit -m "feat(web): add trial status to StatusBadge's 4-way status system"
```

---

### Task 5: `Sheet` primitive (`web/src/components/ui/sheet.tsx`)

**Files:**
- Create: `web/src/components/ui/sheet.tsx`
- Test: `web/src/components/ui/__tests__/sheet.test.tsx`

**Interfaces:**
- Produces: `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`, `SheetClose` — standard shadcn Sheet API, built on the already-installed `@radix-ui/react-dialog` (no new npm package). `SheetContent` accepts a `side?: 'top' | 'right' | 'bottom' | 'left'` prop, default `'right'`. This is consumed by Batch 2's Archive side-sheet dialog — not used by anything in Batch 1, but Batch 1 is where the shared primitive is added since it's pure infrastructure with no product dependency.

- [ ] **Step 1: Confirm the dependency is already present**

Run: `cd web && cat package.json | grep '@radix-ui/react-dialog'`
Expected: a version is listed (already installed per the existing `web/src/components/ui/dialog.tsx`). Do not run `npm install` for this task.

- [ ] **Step 2: Write the failing test**

Create `web/src/components/ui/__tests__/sheet.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../sheet';

describe('Sheet', () => {
  it('renders its content with title and description when open', () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Archive Acme Conf Group</SheetTitle>
            <SheetDescription>Starts a 30-day retention clock.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByText('Archive Acme Conf Group')).toBeInTheDocument();
    expect(screen.getByText('Starts a 30-day retention clock.')).toBeInTheDocument();
  });

  it('applies right-side positioning classes by default', () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Right-side sheet</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
    const content = screen.getByText('Right-side sheet').closest('[role="dialog"]');
    expect(content?.className).toContain('right-0');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/ui/__tests__/sheet.test.tsx`
Expected: FAIL with "Cannot find module '../sheet'"

- [ ] **Step 4: Implement**

Read `web/src/components/ui/dialog.tsx` first to match its exact `cn()` import path and `X` icon import convention (`import { cn } from '@/lib/utils'`, `import { X } from 'lucide-react'` — confirm both before writing, adjust if this codebase's dialog.tsx uses different names/paths).

Create `web/src/components/ui/sheet.tsx`:

```tsx
import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn('fixed inset-0 z-50 bg-black/50', className)}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  'fixed z-50 gap-4 bg-background p-6 shadow-lg flex flex-col',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b',
        bottom: 'inset-x-0 bottom-0 border-t',
        left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
        right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
      },
    },
    defaultVariants: { side: 'right' },
  }
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-left', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('mt-auto flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
SheetFooter.displayName = 'SheetFooter';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
```

If `class-variance-authority` import style differs from this codebase's convention elsewhere (check `web/src/components/ui/button.tsx` for the exact `cva` usage pattern already established), match that file's style instead of the snippet above.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/ui/__tests__/sheet.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/ui/sheet.tsx src/components/ui/__tests__/sheet.test.tsx`

```bash
git add web/src/components/ui/sheet.tsx web/src/components/ui/__tests__/sheet.test.tsx
git commit -m "feat(web): add shadcn Sheet primitive (for Batch 2's Archive side-sheet)"
```

---

### Task 6: Design token reconciliation (`web/src/index.css`)

**Files:**
- Modify: `web/src/index.css`

**Interfaces:**
- Produces: new CSS custom properties `--console-chrome`, `--console-chrome-active`, `--console-chrome-foreground`, `--console-chrome-muted-foreground` (dark top-bar surface, same value in both light and dark mode per the design's own note "the chrome stays #101013 in both themes"); `--status-trial`, `--status-trial-foreground`, `--status-trial-bg`, `--status-trial-border` (the only status-quad member the existing system has no analog for — active/suspended/archived already have usable existing tokens via `--primary`/amber-500/`--muted`, matched in Task 4). No existing variable is renamed or removed.

**Note:** this task is pure CSS-variable definitions. `jsdom` (used by the vitest suite from Task 2) does not reliably compute cascaded custom-property values the way a real browser does, so this task has no unit test — verify it visually in the final live-browser pass at the end of this batch (per this session's established pattern for CSS-only changes). Do not skip the lint/build check below.

- [ ] **Step 1: Add the new CSS variables**

In `web/src/index.css`, inside the existing `:root { ... }` block (the one starting `--background: 0 0% 100%;`), add after the existing `--radius: 0.5rem;` line:

```css
    --radius: 0.5rem;

    /* Platform Console dark top-chrome shell — same values in light and dark mode by design. */
    --console-chrome: 240 4% 7%; /* #101013 */
    --console-chrome-active: 240 3% 15%; /* #232327 */
    --console-chrome-foreground: 0 0% 100%;
    --console-chrome-muted-foreground: 240 2% 63%; /* #9d9da6 */

    /* Status-quad: trial is the one status color with no existing analog (active/suspended/archived reuse --primary/amber-500/--muted). */
    --status-trial: 217 91% 60%; /* #2563eb */
    --status-trial-foreground: 224 76% 48%; /* #1d4ed8 */
    --status-trial-bg: 214 100% 97%; /* #eff6ff */
    --status-trial-border: 213 97% 87%; /* #bfdbfe */
```

Add the identical block inside `.dark { ... }` as well (same values — the design explicitly keeps the dark chrome constant across themes, and the trial status color is likewise the same by convention with the other 3 status colors, which also don't shift hue between themes in this codebase, only lightness of surrounding chrome does):

```css
    --console-chrome: 240 4% 7%;
    --console-chrome-active: 240 3% 15%;
    --console-chrome-foreground: 0 0% 100%;
    --console-chrome-muted-foreground: 240 2% 63%;

    --status-trial: 217 91% 60%;
    --status-trial-foreground: 224 76% 48%;
    --status-trial-bg: 214 100% 97%;
    --status-trial-border: 213 97% 87%;
```

- [ ] **Step 2: Expose them as utility classes**

In the existing `@layer utilities { ... }` block, after the existing `.ring-ring { --tw-ring-color: hsl(var(--ring)); }` line, add:

```css
  .bg-console-chrome { background-color: hsl(var(--console-chrome)); }
  .bg-console-chrome-active { background-color: hsl(var(--console-chrome-active)); }
  .text-console-chrome-foreground { color: hsl(var(--console-chrome-foreground)); }
  .text-console-chrome-muted-foreground { color: hsl(var(--console-chrome-muted-foreground)); }
```

- [ ] **Step 3: Build check**

Run: `cd web && npx tsc -b --noEmit && npm run build`
Expected: build succeeds (Tailwind v4's CSS-first pipeline picks up the new `@layer utilities` classes automatically — no separate Tailwind config to touch).

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css
git commit -m "feat(web): add console dark-chrome and trial-status design tokens"
```

---

### Task 7: `SuperAdminLayout` dark-chrome shell restructure

**Files:**
- Modify: `web/src/pages/super-admin/SuperAdminLayout.tsx`
- Modify: `web/src/i18n.ts`
- Test: `web/src/pages/super-admin/__tests__/SuperAdminLayout.test.tsx`

**Interfaces:**
- Consumes: `--console-chrome`/`--console-chrome-active` classes from Task 6.
- Produces: same export shape (`export default function SuperAdminLayout()`, no props, rendered via `<Outlet />`) — no router changes needed. Top nav items keyed by `path`, active-state now derived from `useLocation().pathname` with an `isActive(path)` helper: `path === '/super-admin' ? pathname === path : pathname.startsWith(path)` (so `/super-admin/organizations/:id` still highlights "Organizations"). This `isActive` function is the piece under test — export it for the test (see Step 4) even though it isn't used outside this file, since it's the only meaningfully-testable logic in a pure-shell component.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/super-admin/__tests__/SuperAdminLayout.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { isActiveNavPath } from '../SuperAdminLayout';

describe('isActiveNavPath', () => {
  it('matches the dashboard root only on an exact path', () => {
    expect(isActiveNavPath('/super-admin', '/super-admin')).toBe(true);
    expect(isActiveNavPath('/super-admin', '/super-admin/organizations')).toBe(false);
  });

  it('matches nested routes by prefix for non-root items', () => {
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/organizations')).toBe(true);
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/organizations/abc-123')).toBe(true);
    expect(isActiveNavPath('/super-admin/organizations', '/super-admin/plans')).toBe(false);
  });

  it('does not cross-match distinct top-level sections that share a prefix', () => {
    expect(isActiveNavPath('/super-admin/users', '/super-admin/organizations')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/SuperAdminLayout.test.tsx`
Expected: FAIL — `isActiveNavPath` is not exported yet (module has no such export).

- [ ] **Step 3: Add i18n keys for the new shell**

In `web/src/i18n.ts`, in the English `// Super Admin` section (near `superAdminPanel` at line 673), add:
```ts
  platformConsole: 'PLATFORM CONSOLE',
  searchTenantsPlaceholder: 'Search tenants by name, slug, owner email…',
```
And the matching Russian keys near the mirrored section:
```ts
  platformConsole: 'ПЛАТФОРМЕННАЯ КОНСОЛЬ',
  searchTenantsPlaceholder: 'Поиск тенантов по имени, slug, email владельца…',
```

- [ ] **Step 4: Implement the shell restructure**

Replace the full contents of `web/src/pages/super-admin/SuperAdminLayout.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Building2, ClipboardList, FileText, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LanguageToggle } from '@/components/language-toggle';
import { ModeToggle } from '@/components/mode-toggle';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';

export function isActiveNavPath(itemPath: string, pathname: string): boolean {
  if (itemPath === '/super-admin') return pathname === itemPath;
  return pathname.startsWith(itemPath);
}

export default function SuperAdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');

  const menuItems = [
    { icon: BarChart3, label: t('dashboard'), path: '/super-admin' },
    { icon: Building2, label: t('organizations'), path: '/super-admin/organizations' },
    { icon: FileText, label: t('subscriptionPlans'), path: '/super-admin/plans' },
    { icon: Users, label: t('allUsers'), path: '/super-admin/users' },
    { icon: ClipboardList, label: t('auditLog'), path: '/super-admin/audit' },
  ];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/super-admin/organizations?q=${encodeURIComponent(q)}` : '/super-admin/organizations');
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('current_tenant');
    navigate('/login');
  }

  let user: { email?: string } = {};
  try {
    user = JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    user = {};
  }
  const initials = (user.email || '?').slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col h-screen bg-background">
      <ImpersonationBanner />
      <header className="flex items-center gap-4 border-b border-black/10 bg-console-chrome px-4 py-2 text-console-chrome-foreground">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            И
          </div>
          <span className="font-semibold">Idento</span>
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary">
            {t('platformConsole')}
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {menuItems.map((item) => {
            const active = isActiveNavPath(item.path, pathname);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-console-chrome-active text-console-chrome-foreground'
                    : 'text-console-chrome-muted-foreground hover:text-console-chrome-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form onSubmit={handleSearchSubmit} className="ml-4 flex flex-1 items-center">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-console-chrome-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchTenantsPlaceholder')}
              className="h-8 border-white/10 bg-white/5 pl-8 text-sm text-console-chrome-foreground placeholder:text-console-chrome-muted-foreground focus-visible:ring-primary"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-console-chrome-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </form>
        <div className="flex items-center gap-3">
          <ModeToggle />
          <LanguageToggle />
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            title={user.email}
          >
            {initials}
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="border-white/20 bg-transparent text-console-chrome-foreground hover:bg-white/10">
            {t('logout')}
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
```

Note the two intentional, honest deviations from the design's exact nav list:
- No "Analytics" nav item — the design's own `1a`/`1b` nav bar includes one but no screen for it exists anywhere in the source file (a dangling reference in the design doc itself); the existing `/super-admin/analytics` route and page stay reachable but are not promoted to top-level nav in this reskin. Flag this back to the user as an open question in the batch summary rather than silently dropping the working Analytics page from navigation — if they want it kept in the nav, it's a one-line addition.
- `ClipboardList` icon used for Audit Log instead of reusing `Settings` (the old sidebar's icon), and `BarChart3` is no longer duplicated between Dashboard and Analytics since Analytics isn't in this nav — this fixes the icon-collision gap noted during research.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/SuperAdminLayout.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/SuperAdminLayout.tsx src/i18n.ts src/pages/super-admin/__tests__/SuperAdminLayout.test.tsx`

```bash
git add web/src/pages/super-admin/SuperAdminLayout.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/SuperAdminLayout.test.tsx
git commit -m "feat(web): dark-chrome top-nav shell for the Platform Console"
```

---

### Task 8: Shared tenant-queue utilities + `BarRow` promotion

**Files:**
- Create: `web/src/lib/tenantQueues.ts`, `web/src/components/BarRow.tsx`
- Modify: `web/src/pages/super-admin/Analytics.tsx` (replace its private `BarRow` with the shared one)
- Test: `web/src/lib/__tests__/tenantQueues.test.ts`, `web/src/components/__tests__/BarRow.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // web/src/lib/tenantQueues.ts
  export type TenantStat = {
    tenant?: { id?: string; name?: string; status?: string };
    subscription?: {
      status?: string;
      trial_end_date?: string | null;
      custom_limits?: Record<string, number> | null;
      plan?: { name?: string; slug?: string; limits?: Record<string, number> };
    };
    users_count?: number;
    events_count?: number;
    attendees_count?: number;
    last_activity?: string | null;
  };
  export function trialsEndingWithinDays(tenants: TenantStat[], days: number): TenantStat[];
  export function overLimitTenants(tenants: TenantStat[]): TenantStat[]; // any of events/attendees/users over its resolved limit
  export function onCustomLimitTenants(tenants: TenantStat[]): TenantStat[];
  export function resolvedLimit(sub: TenantStat['subscription'], key: 'events_per_month' | 'attendees_per_event' | 'users'): number; // custom_limits override, else plan.limits, else -1 (unlimited-safe default)
  ```
  ```tsx
  // web/src/components/BarRow.tsx
  export function BarRow({ label, count, max }: { label: string; count: number; max: number }): JSX.Element;
  ```
- Consumed by: Task 9 (Tenants list saved-queue chips + Attendees-vs-limit column), Task 10 (Dashboard queues + analytics row), and `Analytics.tsx` (restyled to import the shared `BarRow` instead of its own copy).

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/__tests__/tenantQueues.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { trialsEndingWithinDays, overLimitTenants, onCustomLimitTenants, resolvedLimit, type TenantStat } from '../tenantQueues';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

describe('resolvedLimit', () => {
  it('prefers a custom limit over the plan limit', () => {
    const sub: TenantStat['subscription'] = {
      custom_limits: { attendees_per_event: 10000 },
      plan: { limits: { attendees_per_event: 500 } },
    };
    expect(resolvedLimit(sub, 'attendees_per_event')).toBe(10000);
  });
  it('falls back to the plan limit when no custom override exists', () => {
    const sub: TenantStat['subscription'] = { plan: { limits: { events_per_month: 10 } } };
    expect(resolvedLimit(sub, 'events_per_month')).toBe(10);
  });
  it('defaults to unlimited (-1) when neither exists', () => {
    expect(resolvedLimit(undefined, 'users')).toBe(-1);
    expect(resolvedLimit({}, 'users')).toBe(-1);
  });
});

describe('trialsEndingWithinDays', () => {
  it('includes only trial tenants whose trial_end_date is within the window', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, subscription: { status: 'trial', trial_end_date: daysFromNow(3) } },
      { tenant: { id: '2' }, subscription: { status: 'trial', trial_end_date: daysFromNow(20) } },
      { tenant: { id: '3' }, subscription: { status: 'active', trial_end_date: daysFromNow(3) } },
      { tenant: { id: '4' }, subscription: { status: 'trial', trial_end_date: null } },
    ];
    const result = trialsEndingWithinDays(tenants, 7);
    expect(result.map((t) => t.tenant?.id)).toEqual(['1']);
  });
});

describe('overLimitTenants', () => {
  it('flags a tenant over its attendees limit', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, attendees_count: 600, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
      { tenant: { id: '2' }, attendees_count: 100, subscription: { plan: { limits: { attendees_per_event: 500 } } } },
    ];
    expect(overLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
  it('never flags an unlimited (-1) plan regardless of usage', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, attendees_count: 999999, subscription: { plan: { limits: { attendees_per_event: -1 } } } },
    ];
    expect(overLimitTenants(tenants)).toEqual([]);
  });
});

describe('onCustomLimitTenants', () => {
  it('includes tenants with a non-empty custom_limits object', () => {
    const tenants: TenantStat[] = [
      { tenant: { id: '1' }, subscription: { custom_limits: { users: 20 } } },
      { tenant: { id: '2' }, subscription: { custom_limits: {} } },
      { tenant: { id: '3' }, subscription: { custom_limits: null } },
      { tenant: { id: '4' }, subscription: {} },
    ];
    expect(onCustomLimitTenants(tenants).map((t) => t.tenant?.id)).toEqual(['1']);
  });
});
```

Create `web/src/components/__tests__/BarRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarRow } from '../BarRow';

describe('BarRow', () => {
  it('renders the label and count', () => {
    render(<BarRow label="Mon" count={42} max={100} />);
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('gives a minimum visible width even for a zero count', () => {
    const { container } = render(<BarRow label="Tue" count={0} max={100} />);
    const bar = container.querySelector('[style*="width"]');
    expect(bar).toBeTruthy();
    const width = bar?.getAttribute('style') || '';
    expect(width).toContain('4%');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/__tests__/tenantQueues.test.ts src/components/__tests__/BarRow.test.tsx`
Expected: FAIL — neither module exists yet.

- [ ] **Step 3: Implement `tenantQueues.ts`**

Create `web/src/lib/tenantQueues.ts`:

```ts
export type TenantStat = {
  tenant?: { id?: string; name?: string; status?: string };
  subscription?: {
    status?: string;
    trial_end_date?: string | null;
    custom_limits?: Record<string, number> | null;
    plan?: { name?: string; slug?: string; limits?: Record<string, number> };
  };
  users_count?: number;
  events_count?: number;
  attendees_count?: number;
  last_activity?: string | null;
};

const UNLIMITED = -1;

export function resolvedLimit(
  sub: TenantStat['subscription'] | undefined,
  key: 'events_per_month' | 'attendees_per_event' | 'users'
): number {
  const custom = sub?.custom_limits?.[key];
  if (typeof custom === 'number') return custom;
  const planLimit = sub?.plan?.limits?.[key];
  if (typeof planLimit === 'number') return planLimit;
  return UNLIMITED;
}

export function trialsEndingWithinDays(tenants: TenantStat[], days: number): TenantStat[] {
  const now = Date.now();
  const cutoff = now + days * 24 * 60 * 60 * 1000;
  return tenants.filter((t) => {
    if (t.subscription?.status !== 'trial') return false;
    if (!t.subscription.trial_end_date) return false;
    const end = new Date(t.subscription.trial_end_date).getTime();
    return end >= now && end <= cutoff;
  });
}

function isOverLimit(t: TenantStat): boolean {
  const checks: Array<['events_per_month' | 'attendees_per_event' | 'users', number]> = [
    ['events_per_month', t.events_count ?? 0],
    ['attendees_per_event', t.attendees_count ?? 0],
    ['users', t.users_count ?? 0],
  ];
  return checks.some(([key, count]) => {
    const limit = resolvedLimit(t.subscription, key);
    return limit !== UNLIMITED && count > limit;
  });
}

export function overLimitTenants(tenants: TenantStat[]): TenantStat[] {
  return tenants.filter(isOverLimit);
}

export function onCustomLimitTenants(tenants: TenantStat[]): TenantStat[] {
  return tenants.filter((t) => {
    const cl = t.subscription?.custom_limits;
    return !!cl && Object.keys(cl).length > 0;
  });
}
```

- [ ] **Step 4: Implement `BarRow.tsx`**

Create `web/src/components/BarRow.tsx`:

```tsx
export function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div
        className="h-3 rounded bg-primary"
        style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 4}%` }}
      />
      <span className="tabular-nums">{count}</span>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/__tests__/tenantQueues.test.ts src/components/__tests__/BarRow.test.tsx`
Expected: PASS, 8 tests total.

- [ ] **Step 6: Point `Analytics.tsx` at the shared `BarRow`**

In `web/src/pages/super-admin/Analytics.tsx`, delete the private `BarRow` function definition (the one matching):
```tsx
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-3 rounded bg-primary" style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 4}%` }} />
      <span className="tabular-nums">{count}</span>
    </div>
  );
}
```
and add an import at the top of the file instead:
```tsx
import { BarRow } from '@/components/BarRow';
```

- [ ] **Step 7: Verify no regression**

Run: `cd web && npx tsc -b --noEmit && npx vitest run`
Expected: all tests still pass (no import errors in `Analytics.tsx`).

- [ ] **Step 8: Lint and commit**

Run: `cd web && npx eslint src/lib/tenantQueues.ts src/components/BarRow.tsx src/pages/super-admin/Analytics.tsx src/lib/__tests__/tenantQueues.test.ts src/components/__tests__/BarRow.test.tsx`

```bash
git add web/src/lib/tenantQueues.ts web/src/components/BarRow.tsx web/src/pages/super-admin/Analytics.tsx web/src/lib/__tests__/tenantQueues.test.ts web/src/components/__tests__/BarRow.test.tsx
git commit -m "feat(web): shared tenant-queue filters and promote BarRow to a shared component"
```

---

### Task 9: Tenants list reskin (`Organizations.tsx`)

**Files:**
- Modify: `web/src/pages/super-admin/Organizations.tsx`, `web/src/i18n.ts`
- Test: `web/src/pages/super-admin/__tests__/Organizations.test.tsx`

**Interfaces:**
- Consumes: `TenantStat`, `trialsEndingWithinDays`, `overLimitTenants`, `onCustomLimitTenants`, `resolvedLimit` from Task 8; `meterTone`, `meterToneClass` from Task 3; `StatusBadge` (4-way, Task 4).
- Produces: same route/component (`export default function Organizations()`), same `GET /api/super-admin/tenants` data source — no backend/API changes. Reads an initial `?q=` search param from the URL (set by Task 7's shell search box) via `useSearchParams`.

- [ ] **Step 1: Add i18n keys**

In `web/src/i18n.ts`, near the existing Organizations-list keys (around line 679-684), add to the English block:
```ts
  savedQueueAll: 'All',
  savedQueueTrialsExpiring: 'Trials expiring this week',
  savedQueueOverLimit: 'Over limit',
  savedQueueSuspended: 'Suspended',
  savedQueueCustomLimits: 'On custom limits',
  overLimitBadge: 'OVER LIMIT',
  customPlanBadge: 'CUSTOM',
  lastActivityColumn: 'Last activity',
  attendeesVsLimitColumn: 'Attendees vs limit',
  paginationOf: '{{from}}–{{to}} of {{total}}',
  previousPage: 'Previous',
  nextPage: 'Next',
```
and the matching Russian block:
```ts
  savedQueueAll: 'Все',
  savedQueueTrialsExpiring: 'Пробный период истекает на этой неделе',
  savedQueueOverLimit: 'Превышен лимит',
  savedQueueSuspended: 'Приостановлены',
  savedQueueCustomLimits: 'С индивидуальными лимитами',
  overLimitBadge: 'ПРЕВЫШЕН ЛИМИТ',
  customPlanBadge: 'ИНДИВИДУАЛЬНЫЙ',
  lastActivityColumn: 'Последняя активность',
  attendeesVsLimitColumn: 'Участники / лимит',
  paginationOf: '{{from}}–{{to}} из {{total}}',
  previousPage: 'Назад',
  nextPage: 'Вперёд',
```

- [ ] **Step 2: Write the failing test**

Read the full current `web/src/pages/super-admin/Organizations.tsx` first (needed to know its exact current state-variable names — `searchQuery`, `planFilter`, `statusFilter`, `tenants`, `filteredTenants` — confirmed by prior research; re-confirm via `grep -n "useState\|const \[" web/src/pages/super-admin/Organizations.tsx` before writing the test, since the test asserts on rendered output, not internals).

Create `web/src/pages/super-admin/__tests__/Organizations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Organizations from '../Organizations';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockTenants = [
  {
    tenant: { id: '1', name: 'Acme Conf Group', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    subscription: { status: 'active', plan: { name: 'Professional', slug: 'pro', limits: { attendees_per_event: 500 } } },
    users_count: 4,
    events_count: 2,
    attendees_count: 600,
    last_activity: '2026-07-01T00:00:00Z',
  },
  {
    tenant: { id: '2', name: 'Forum One', status: 'suspended', created_at: '2026-02-01T00:00:00Z' },
    subscription: { status: 'trial', plan: { name: 'Starter', slug: 'starter', limits: { attendees_per_event: 100 } } },
    users_count: 1,
    events_count: 1,
    attendees_count: 50,
    last_activity: null,
  },
];

describe('Organizations (Tenants list)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: mockTenants });
  });

  it('renders an OVER LIMIT badge only for the tenant that exceeds its plan limit', async () => {
    render(
      <MemoryRouter>
        <Organizations />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Acme Conf Group')).toBeInTheDocument());
    const rows = screen.getAllByRole('row');
    const acmeRow = rows.find((r) => r.textContent?.includes('Acme Conf Group'));
    const forumRow = rows.find((r) => r.textContent?.includes('Forum One'));
    expect(acmeRow?.textContent).toContain('OVER LIMIT');
    expect(forumRow?.textContent).not.toContain('OVER LIMIT');
  });

  it('renders the saved-queue chip counts', async () => {
    render(
      <MemoryRouter>
        <Organizations />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/All/)).toBeInTheDocument());
    expect(screen.getByText((_, el) => el?.textContent === 'Over limit · 1')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === 'Suspended · 1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/Organizations.test.tsx`
Expected: FAIL — no "OVER LIMIT" text and no saved-queue chips exist in the current component yet.

- [ ] **Step 4: Implement**

This step modifies an existing 285-line file. Apply these changes to `web/src/pages/super-admin/Organizations.tsx` (read the current file first and adapt anchors if line numbers have drifted from the researched version):

1. Add imports at the top:
```tsx
import { useSearchParams } from 'react-router-dom';
import { trialsEndingWithinDays, overLimitTenants, onCustomLimitTenants, resolvedLimit, type TenantStat } from '@/lib/tenantQueues';
import { meterTone, meterToneClass } from '@/lib/meters';
```

2. Replace the `searchQuery` initial state and add URL-param seeding + saved-queue state + pagination state. Where the file currently has:
```tsx
const [searchQuery, setSearchQuery] = useState('');
```
change to:
```tsx
const [searchParams] = useSearchParams();
const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
const [savedQueue, setSavedQueue] = useState<'all' | 'trials' | 'over_limit' | 'suspended' | 'custom_limits'>('all');
const [page, setPage] = useState(1);
const PAGE_SIZE = 14;
```

3. Add a saved-queue filter step to `filterTenants()` (or wherever `filteredTenants` is computed), inserted before the existing search/plan/status filtering — apply the saved-queue selector first, then run the existing filters on top of that subset:
```tsx
function applySavedQueue(list: TenantStat[]): TenantStat[] {
  switch (savedQueue) {
    case 'trials':
      return trialsEndingWithinDays(list, 7);
    case 'over_limit':
      return overLimitTenants(list);
    case 'suspended':
      return list.filter((t) => t.tenant?.status === 'suspended');
    case 'custom_limits':
      return onCustomLimitTenants(list);
    default:
      return list;
  }
}
```
Update the existing filtering `useEffect`/function so its base list is `applySavedQueue(tenants)` instead of `tenants`, and add `savedQueue` to its dependency array. Reset `page` to `1` in the same effect whenever `savedQueue`, `searchQuery`, `planFilter`, or `statusFilter` changes (add a `setPage(1)` call at the top of that effect).

4. Add the saved-queue chip bar, placed directly above the existing search/filter controls row:
```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {([
    ['all', t('savedQueueAll'), tenants.length],
    ['trials', t('savedQueueTrialsExpiring'), trialsEndingWithinDays(tenants, 7).length],
    ['over_limit', t('savedQueueOverLimit'), overLimitTenants(tenants).length],
    ['suspended', t('savedQueueSuspended'), tenants.filter((t) => t.tenant?.status === 'suspended').length],
    ['custom_limits', t('savedQueueCustomLimits'), onCustomLimitTenants(tenants).length],
  ] as const).map(([key, label, count]) => (
    <button
      key={key}
      type="button"
      onClick={() => setSavedQueue(key)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        savedQueue === key
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border text-muted-foreground hover:bg-accent/50'
      }`}
    >
      {label} · {count}
    </button>
  ))}
</div>
```

5. Replace the "Attendees" column cell (currently likely a bare `{tenant.attendees_count}`) with a meter-aware cell, and add an OVER LIMIT sub-badge under the existing lifecycle `StatusBadge` cell:
```tsx
<TableCell>
  {(() => {
    const limit = resolvedLimit(tenant.subscription, 'attendees_per_event');
    const tone = meterTone(tenant.attendees_count ?? 0, limit);
    return (
      <span className={meterToneClass(tone)}>
        {tenant.attendees_count ?? 0}
        {limit !== -1 ? ` / ${limit}` : ''}
      </span>
    );
  })()}
</TableCell>
```
```tsx
<TableCell>
  <StatusBadge status={tenant.tenant?.status} />
  {overLimitTenants([tenant]).length > 0 && (
    <div className="mt-1 text-[10px] font-semibold text-destructive">{t('overLimitBadge')}</div>
  )}
</TableCell>
```

6. Add a `CUSTOM` badge next to the plan name cell:
```tsx
<TableCell>
  {tenant.subscription?.plan?.name}
  {onCustomLimitTenants([tenant]).length > 0 && (
    <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {t('customPlanBadge')}
    </span>
  )}
</TableCell>
```

7. Add a "Last activity" column header and cell (new column — the field already exists in the API response but was previously unused):
```tsx
<TableHead>{t('lastActivityColumn')}</TableHead>
```
```tsx
<TableCell>
  {tenant.last_activity ? new Date(tenant.last_activity).toLocaleDateString() : '—'}
</TableCell>
```

8. Replace the static `{filteredTenants.length} {t('of')} {tenants.length}` summary line with real client-side pagination. Slice the rendered rows:
```tsx
const pageStart = (page - 1) * PAGE_SIZE;
const pagedTenants = filteredTenants.slice(pageStart, pageStart + PAGE_SIZE);
```
(map over `pagedTenants` instead of `filteredTenants` in the table body), and replace the summary line with:
```tsx
<div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
  <span>
    {t('paginationOf', {
      from: filteredTenants.length === 0 ? 0 : pageStart + 1,
      to: Math.min(pageStart + PAGE_SIZE, filteredTenants.length),
      total: filteredTenants.length,
    })}
  </span>
  <div className="flex gap-2">
    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
      {t('previousPage')}
    </Button>
    <Button
      variant="outline"
      size="sm"
      disabled={pageStart + PAGE_SIZE >= filteredTenants.length}
      onClick={() => setPage((p) => p + 1)}
    >
      {t('nextPage')}
    </Button>
  </div>
</div>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/Organizations.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full suite, typecheck, lint, commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/Organizations.tsx src/i18n.ts && npx vitest run`
Expected: all tests pass, no lint/type errors.

```bash
git add web/src/pages/super-admin/Organizations.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/Organizations.test.tsx
git commit -m "feat(web): reskin Tenants list — saved-queue chips, usage meters, custom/over-limit badges, pagination"
```

---

### Task 10: Dashboard reskin (`Dashboard.tsx`)

**Files:**
- Modify: `web/src/pages/super-admin/Dashboard.tsx`, `web/src/i18n.ts`
- Test: `web/src/pages/super-admin/__tests__/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `TenantStat`, `trialsEndingWithinDays`, `overLimitTenants`, `resolvedLimit` from Task 8; `meterTone`, `meterToneClass` from Task 3; `BarRow` from Task 8; existing `GET /api/super-admin/tenants` and `GET /api/super-admin/analytics` (the latter already implemented and used by `Analytics.tsx` — same `PlatformAnalytics` response shape, no new endpoint).
- Produces: same route/component (`export default function SuperAdminDashboard()`).

- [ ] **Step 1: Add i18n keys**

In `web/src/i18n.ts`, near the existing Dashboard KPI keys (around line 717-723), add to the English block:
```ts
  activeTenantsKpi: 'Active tenants',
  onTrialKpi: 'On trial',
  suspendedKpi: 'Suspended',
  paidConversionKpi: 'Paid conversion',
  activeEventsKpi: 'Active events now',
  checkinsTodayKpi: 'Check-ins today',
  trialsEndingQueue: 'Trials ending within 7 days',
  overLimitQueue: 'Over limit',
  recentlySuspendedQueue: 'Recently suspended',
  extendTrialAction: 'Extend trial',
  reviewAction: 'Review',
  reactivateAction: 'Reactivate',
  reactivateDone: 'Tenant reactivated',
  reactivateFailed: 'Failed to reactivate tenant',
  noItemsInQueue: 'Nothing here right now',
  signupsByWeekChart: 'Signups per week',
  checkinsPerDayChart: 'Check-ins per day',
  tenantsByPlanChart: 'Tenants by plan',
  topTenantsByUsage: 'Top tenants by usage (attendees)',
```
and the matching Russian block:
```ts
  activeTenantsKpi: 'Активных тенантов',
  onTrialKpi: 'На пробном периоде',
  suspendedKpi: 'Приостановлено',
  paidConversionKpi: 'Конверсия в оплату',
  activeEventsKpi: 'Активных событий сейчас',
  checkinsTodayKpi: 'Регистраций сегодня',
  trialsEndingQueue: 'Пробный период истекает в течение 7 дней',
  overLimitQueue: 'Превышен лимит',
  recentlySuspendedQueue: 'Недавно приостановлены',
  extendTrialAction: 'Продлить пробный период',
  reviewAction: 'Просмотреть',
  reactivateAction: 'Активировать',
  reactivateDone: 'Тенант активирован',
  reactivateFailed: 'Не удалось активировать тенант',
  noItemsInQueue: 'Сейчас здесь пусто',
  signupsByWeekChart: 'Регистрации по неделям',
  checkinsPerDayChart: 'Регистрации по дням',
  tenantsByPlanChart: 'Тенанты по тарифу',
  topTenantsByUsage: 'Топ тенантов по использованию (участники)',
```

- [ ] **Step 2: Write the failing test**

Create `web/src/pages/super-admin/__tests__/Dashboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockTenants = [
  {
    tenant: { id: '1', name: 'Acme Conf Group', status: 'active' },
    subscription: { status: 'active', plan: { limits: { attendees_per_event: 500 } } },
    users_count: 4, events_count: 2, attendees_count: 600, last_activity: null,
  },
  {
    tenant: { id: '2', name: 'Forum One', status: 'suspended' },
    subscription: { status: 'trial', trial_end_date: new Date(Date.now() + 2 * 86400000).toISOString(), plan: { limits: { attendees_per_event: 100 } } },
    users_count: 1, events_count: 1, attendees_count: 10, last_activity: null,
  },
];

const mockAnalytics = {
  tenants_by_status: { active: 1, suspended: 1 },
  tenants_by_plan: [{ plan: 'pro', count: 1 }],
  signups_by_week: [{ period: '2026-07-01', count: 5 }],
  active_events: 3,
  checkins_by_day: [{ period: '2026-07-09', count: 12 }, { period: '2026-07-10', count: 34 }],
  total_tenants: 2,
  paid_tenants: 1,
  paid_conversion: 0.5,
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('analytics')) return Promise.resolve({ data: mockAnalytics });
      return Promise.resolve({ data: mockTenants });
    });
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'active' } });
  });

  it('renders the over-limit queue with the tenant that exceeds its limit', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Acme Conf Group')).toBeInTheDocument());
  });

  it('calls the reactivate endpoint when clicking Reactivate in the recently-suspended queue', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/Reactivate|Активировать/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/Reactivate|Активировать/)[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/reactivate')));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/Dashboard.test.tsx`
Expected: FAIL — current `Dashboard.tsx` has no over-limit queue or Reactivate button.

- [ ] **Step 4: Implement**

Read the current full `web/src/pages/super-admin/Dashboard.tsx` first, then replace its contents:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, CalendarClock, CheckCircle2, TrendingUp, Users, Zap } from 'lucide-react';
import {
  trialsEndingWithinDays,
  overLimitTenants,
  resolvedLimit,
  type TenantStat,
} from '@/lib/tenantQueues';
import { meterTone, meterToneClass } from '@/lib/meters';
import { BarRow } from '@/components/BarRow';

type PlatformAnalytics = {
  tenants_by_plan: { plan: string; count: number }[] | null;
  signups_by_week: { period: string; count: number }[] | null;
  checkins_by_day: { period: string; count: number }[] | null;
  active_events: number;
  paid_conversion: number;
};

export default function SuperAdminDashboard() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<TenantStat[]>([]);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [tenantsRes, analyticsRes] = await Promise.all([
        api.get('/api/super-admin/tenants'),
        api.get('/api/super-admin/analytics'),
      ]);
      setTenants(tenantsRes.data || []);
      setAnalytics(analyticsRes.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleReactivate(id: string) {
    setReactivatingId(id);
    try {
      await api.post(`/api/super-admin/tenants/${id}/reactivate`);
      toast.success(t('reactivateDone'));
      await load();
    } catch {
      toast.error(t('reactivateFailed'));
    } finally {
      setReactivatingId(null);
    }
  }

  if (loading) {
    return <div className="p-8 animate-pulse text-muted-foreground">…</div>;
  }

  const activeTenants = tenants.filter((t) => t.tenant?.status === 'active');
  const onTrial = tenants.filter((t) => t.subscription?.status === 'trial');
  const suspended = tenants.filter((t) => t.tenant?.status === 'suspended');
  const trialsSoon = trialsEndingWithinDays(tenants, 7);
  const overLimit = overLimitTenants(tenants);
  const checkinsToday = analytics?.checkins_by_day?.length
    ? analytics.checkins_by_day[analytics.checkins_by_day.length - 1].count
    : 0;

  const kpis = [
    { title: t('activeTenantsKpi'), value: activeTenants.length, icon: Building2 },
    { title: t('onTrialKpi'), value: onTrial.length, icon: Zap },
    { title: t('suspendedKpi'), value: suspended.length, icon: CalendarClock },
    { title: t('paidConversionKpi'), value: `${((analytics?.paid_conversion ?? 0) * 100).toFixed(0)}%`, icon: TrendingUp },
    { title: t('activeEventsKpi'), value: analytics?.active_events ?? 0, icon: CheckCircle2 },
    { title: t('checkinsTodayKpi'), value: checkinsToday, icon: Users },
  ];

  const signups = analytics?.signups_by_week ?? [];
  const checkins = analytics?.checkins_by_day ?? [];
  const signupsMax = Math.max(1, ...signups.map((s) => s.count));
  const checkinsMax = Math.max(1, ...checkins.map((c) => c.count));
  const topTenants = [...tenants]
    .sort((a, b) => (b.attendees_count ?? 0) - (a.attendees_count ?? 0))
    .slice(0, 5);
  const topTenantsMax = Math.max(1, ...topTenants.map((t) => t.attendees_count ?? 0));

  return (
    <div className="p-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('trialsEndingQueue')} · {trialsSoon.length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {trialsSoon.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsInQueue')}</p>}
            {trialsSoon.map((tn) => (
              <div key={tn.tenant?.id} className="flex items-center justify-between text-sm">
                <Link to={`/super-admin/organizations/${tn.tenant?.id}`} className="hover:underline">
                  {tn.tenant?.name}
                </Link>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/super-admin/organizations/${tn.tenant?.id}`}>{t('extendTrialAction')}</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('overLimitQueue')} · {overLimit.length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overLimit.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsInQueue')}</p>}
            {overLimit.map((tn) => {
              const limit = resolvedLimit(tn.subscription, 'attendees_per_event');
              const tone = meterTone(tn.attendees_count ?? 0, limit);
              return (
                <div key={tn.tenant?.id} className="flex items-center justify-between text-sm">
                  <span>
                    {tn.tenant?.name}{' '}
                    <span className={meterToneClass(tone)}>
                      ({tn.attendees_count}{limit !== -1 ? `/${limit}` : ''})
                    </span>
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/super-admin/organizations/${tn.tenant?.id}`}>{t('reviewAction')}</Link>
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t('recentlySuspendedQueue')} · {suspended.length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {suspended.length === 0 && <p className="text-sm text-muted-foreground">{t('noItemsInQueue')}</p>}
            {suspended.map((tn) => (
              <div key={tn.tenant?.id} className="flex items-center justify-between text-sm">
                <Link to={`/super-admin/organizations/${tn.tenant?.id}`} className="hover:underline">
                  {tn.tenant?.name}
                </Link>
                <Button
                  size="sm"
                  disabled={reactivatingId === tn.tenant?.id}
                  onClick={() => tn.tenant?.id && handleReactivate(tn.tenant.id)}
                >
                  {t('reactivateAction')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('signupsByWeekChart')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {signups.map((s) => <BarRow key={s.period} label={s.period} count={s.count} max={signupsMax} />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('checkinsPerDayChart')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {checkins.map((c) => <BarRow key={c.period} label={c.period} count={c.count} max={checkinsMax} />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('tenantsByPlanChart')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(analytics?.tenants_by_plan ?? []).map((p) => (
              <BarRow key={p.plan} label={p.plan} count={p.count} max={Math.max(1, ...(analytics?.tenants_by_plan ?? []).map((x) => x.count))} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t('topTenantsByUsage')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {topTenants.map((tn) => (
              <BarRow key={tn.tenant?.id} label={tn.tenant?.name ?? ''} count={tn.attendees_count ?? 0} max={topTenantsMax} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

Honest scope note reflected in the code above: the design's 6th KPI is literally "Trial → paid, 90 d" — since no cohort/time-windowed conversion metric is computed anywhere in the backend, this tile reuses the existing all-time `paid_conversion` field from the Analytics endpoint (already shown on `Analytics.tsx` today) under the label "Paid conversion" rather than fabricating a 90-day-window number. If the user wants a true 90-day cohort metric, that requires a backend follow-up (out of scope here).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/Dashboard.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full suite, typecheck, lint, commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/Dashboard.tsx src/i18n.ts && npx vitest run`
Expected: all pass.

```bash
git add web/src/pages/super-admin/Dashboard.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/Dashboard.test.tsx
git commit -m "feat(web): reskin Platform Console dashboard — real KPI tiles, queues, analytics row"
```

---

## End of Batch 1

After Task 10, do a live-browser click-through of `/super-admin`, `/super-admin/organizations`, and `/super-admin/organizations/:id` (existing detail page, unchanged by this batch but must still render correctly under the new shell) in both light/dark mode and both EN/RU locales, per this session's established verification pattern — this is also the point to visually confirm Task 6's CSS tokens (no unit test covers them). Flag the dropped "Analytics" nav item (see Task 7 note) back to the user before merging.

**Batch 2 (separate plan, written after Batch 1 ships)** covers: Tenant Detail restructure (Summary/Subscription/Lifecycle/Users/Activity sections + sticky anchor rail), Suspend modal + Archive side-sheet (using Task 5's `Sheet` and Task 1's `reason` field), Impersonation ceremony reskin (entry dialog + banner tone + exit summary, using Task 1's `reason` field), Audit log reskin (day-grouping, action badges, diff formatting, session-grouping for impersonation), and the Plans editor reskin.
