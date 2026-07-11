# Platform Console Redesign — Batch 2 (Tenant Detail Workbench) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-Card `OrganizationDetail.tsx` with the design brief's tenant workbench (persistent identity header, five stacked sections behind a sticky anchor rail, a lifecycle state timeline, Suspend modal + Archive side-sheet with per-checkbox acknowledgment, and a ceremonial impersonation entry/exit flow), per `docs/superpowers/specs/2026-07-11-console-redesign-batch2-design.md`.

**Architecture:** Three small backend additions (tenant-scoped audit filter, mandatory reason on subscription changes + impersonation, subscription audit re-targeted from `target_type=subscription` to `target_type=tenant`) unlock a fully data-backed frontend rebuild. Frontend work splits into reusable infra (scroll-spy hook, audit diff/day-grouping utilities + list component, typed-confirm gate hook, identity header) built first, then three new dialog/sheet components, then the page itself assembled section-by-section in the last three tasks. Audit Log page reskin and Plans editor reskin are explicitly out of scope (Batch 3).

**Tech Stack:** Go 1.x / Echo v4 / pgx v5 (backend, Tasks 1–3); React 18.3.1 + Vite + TypeScript + Tailwind v4 + shadcn/radix primitives + react-i18next + react-router-dom v7 + vitest/@testing-library/react (frontend, Tasks 4–12). No new npm/Go dependencies.

## Global Constraints

- **HARD RULE (repeat verbatim in every task's implementer brief):** never modify `web/src/components/ConfirmActionDialog.tsx`. Its fail-closed typed-confirm logic (`requireText = confirmText !== undefined; locked = requireText && (confirmText === '' || typed !== confirmText)`) is reused by extraction into a new shared hook (Task 6), not by editing that file. `ConfirmActionDialog` itself keeps serving Reactivate and any other unmodified caller exactly as today.
- **Reason field policy:** mandatory (empty string rejected client-side with a disabled submit button, and server-side with `400`) for impersonation entry (Task 3) and subscription changes (Task 2). Optional, unchanged, for suspend/reactivate/archive — the per-checkbox acknowledgment is that flow's guardrail instead.
- **No fabricated data.** Live-consequence copy in Suspend/Archive dialogs uses only `users_count`/`events_count`/`attendees_count` already returned by `GET /tenants/:id/stats`. Do not add a "which event is running today" query — that is a documented, deliberate scope cut (see spec's Out of Scope).
- **No last-login column.** The Users tab (Task 11) renders name/email/role/joined-date only. Do not add a `last_login` field anywhere — it does not exist on `models.User` and adding it is out of scope.
- **i18n convention:** flat camelCase keys, added to both `en` and `ru` blocks in `web/src/i18n.ts` in the same relative position, keeping the two blocks in parallel key order. Reuse existing prefix families `tenantStatus_<status>`, `lifecycle_<verb>_<field>` where applicable; new prefix families introduced by this plan: `td_<section>_<field>` for new Tenant Detail workbench copy, `auditAction_<action>` for the human-readable audit action badge labels.
- **Backend gate:** every backend task ends with `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...` passing.
- **Frontend gate:** every frontend task ends with `cd web && npx tsc -b --noEmit && npx eslint <touched files> && npx vitest run` passing.
- **Scroll container fact (verified in `SuperAdminLayout.tsx:122`):** the page's scroll container is `<main className="flex-1 overflow-auto">`, not `window`. Task 4's `useScrollSpy` hook must resolve its `IntersectionObserver` `root` from the nearest ancestor `<main>` element at runtime (`element.closest('main')`), not assume `window`/viewport scrolling — a `root: null` (viewport) observer would fire incorrectly against a page that itself doesn't scroll the window.

---

### Task 1: Backend — `target_id` filter on `GetAuditLog`

**Files:**
- Modify: `backend/internal/store/pg_store.go:1613-1652` (`GetAuditLog`)
- Modify: `backend/internal/handler/super_admin.go:320-358` (`GetAuditLog` handler)
- Test: `backend/internal/handler/super_admin_test.go` (create if missing — package already has `fakeStore` in `testsupport_test.go`)

**Interfaces:**
- Consumes: existing `store.Store.GetAuditLog(ctx context.Context, filters map[string]interface{}, limit int, offset int) ([]*models.AdminAuditLog, int, error)` — **signature unchanged**, only the SQL builder inside `PGStore.GetAuditLog` and the set of keys the handler puts into `filters` change.
- Produces: `GET /api/super-admin/audit-log` now accepts an optional `?target_id=<uuid>` query param, combinable with the existing `?action=`. Invalid/absent `target_id` is silently ignored (same tolerance as the existing `action` param) — never a `400`, since this is a UI-controlled value.

- [ ] **Step 1: Write the failing handler test**

Append to `backend/internal/handler/super_admin_test.go` (create the file with `package handler` + the imports shown if it doesn't exist yet):

```go
package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestGetAuditLog_TargetIDFilterPassedToStore(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	targetID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?target_id="+targetID.String()+"&action=suspend_tenant", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedFilters["target_id"] != targetID {
		t.Fatalf("expected target_id filter %v, got %#v", targetID, capturedFilters["target_id"])
	}
	if capturedFilters["action"] != "suspend_tenant" {
		t.Fatalf("expected action filter preserved, got %#v", capturedFilters["action"])
	}
}

func TestGetAuditLog_InvalidTargetIDIgnoredNot400(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?target_id=not-a-uuid", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (invalid target_id must be ignored, not rejected), got %d", rec.Code)
	}
	if _, ok := capturedFilters["target_id"]; ok {
		t.Fatalf("expected no target_id key when param is invalid, got %#v", capturedFilters)
	}
}
```

Add the missing imports the two tests need (`idento/backend/internal/models`, `github.com/google/uuid`) to the file's `import` block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/... -run TestGetAuditLog -v`
Expected: FAIL — `capturedFilters["target_id"]` is nil/missing because the handler doesn't read the param yet.

- [ ] **Step 3: Add the query param to the handler**

In `backend/internal/handler/super_admin.go`, inside `GetAuditLog` (currently lines 340-343), add after the existing `action` block:

```go
	filters := make(map[string]interface{})
	if action := c.QueryParam("action"); action != "" {
		filters["action"] = action
	}
	if targetIDStr := c.QueryParam("target_id"); targetIDStr != "" {
		if targetID, err := uuid.Parse(targetIDStr); err == nil {
			filters["target_id"] = targetID
		}
	}
```

- [ ] **Step 4: Add the SQL clause in the store**

In `backend/internal/store/pg_store.go`, replace `GetAuditLog`'s WHERE-building (currently only handling `action`) with a generic AND-list builder:

```go
func (s *PGStore) GetAuditLog(ctx context.Context, filters map[string]interface{}, limit int, offset int) ([]*models.AdminAuditLog, int, error) {
	var conditions []string
	var args []interface{}

	if action, ok := filters["action"].(string); ok && action != "" {
		args = append(args, action)
		conditions = append(conditions, fmt.Sprintf("action = $%d", len(args)))
	}
	if targetID, ok := filters["target_id"].(uuid.UUID); ok {
		args = append(args, targetID)
		conditions = append(conditions, fmt.Sprintf("target_id = $%d", len(args)))
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	query := fmt.Sprintf(`SELECT id, admin_user_id, action, target_type, target_id, changes, ip_address::text, user_agent, created_at
	          FROM admin_audit_log %s
	          ORDER BY created_at DESC
	          LIMIT $%d OFFSET $%d`, where, len(args)+1, len(args)+2)
	rows, err := s.db.Query(ctx, query, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []*models.AdminAuditLog
	for rows.Next() {
		var auditLog models.AdminAuditLog
		var changesJSON []byte

		err := rows.Scan(
			&auditLog.ID, &auditLog.AdminUserID, &auditLog.Action, &auditLog.TargetType, &auditLog.TargetID,
			&changesJSON, &auditLog.IPAddress, &auditLog.UserAgent, &auditLog.CreatedAt,
		)
		if err != nil {
			return nil, 0, err
		}

		if len(changesJSON) > 0 {
			if err := json.Unmarshal(changesJSON, &auditLog.Changes); err != nil {
				log.Printf("Failed to unmarshal changes: %v", err)
			}
		}

		logs = append(logs, &auditLog)
	}

	countQuery := "SELECT COUNT(*) FROM admin_audit_log " + where
	var total int
	if err := s.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("get audit log total count: %w", err)
	}

	return logs, total, nil
}
```

Add `"strings"` to `pg_store.go`'s import block if not already present (check with `grep -n '"strings"' backend/internal/store/pg_store.go` first — the file is large and may already import it for other functions).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/... -run TestGetAuditLog -v`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full backend gate and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...`
Expected: all pass (store package has no live-DB test for this function — none exists today, none added here; SQL correctness is covered by the handler test's filter-passthrough assertion plus manual verification in Task 12's live click-through).

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go backend/internal/store/pg_store.go
git commit -m "feat(backend): add target_id filter to GetAuditLog, combinable with action"
```

---

### Task 2: Backend — mandatory `reason` + tenant-targeted audit logging for subscription updates

**Files:**
- Modify: `backend/internal/handler/super_admin.go:87-186` (`UpdateTenantSubscription`)
- Test: `backend/internal/handler/super_admin_test.go` (append)

**Interfaces:**
- Consumes: existing `h.Store.LogAdminAction(ctx, adminID, action, targetType string, targetID uuid.UUID, changes map[string]interface{}, ip, userAgent string) error`; existing `claimsFromContext(c)`; existing `h.Store.GetSubscriptionByTenantID`/`UpsertSubscription`/`UpdateSubscription`.
- Produces: `PATCH /tenants/:id/subscription` now requires a non-empty `"reason"` string in the request body (`400` `{"error": "reason is required"}` if absent/empty); on success, `LogAdminAction` is called with `target_type="tenant"` (previously `"subscription"`) and `target_id=tenantID` (previously `sub.ID`), with `changes["reason"]` set alongside the existing `changes["old"]`/`changes["new"]`. Response body/status codes for the happy path are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/handler/super_admin_test.go`:

```go
func TestUpdateTenantSubscription_ReasonRequired(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	subID := uuid.New()

	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return &models.Subscription{ID: subID, TenantID: tenantID, Status: "active"}, nil
		},
	}
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]string{"status": "active"})
	req := httptest.NewRequest(http.MethodPatch, "/api/super-admin/tenants/"+tenantID.String()+"/subscription", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("UpdateTenantSubscription returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reason is missing, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateTenantSubscription_LogsTenantTargetedWithReason(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	adminID := uuid.New()
	subID := uuid.New()
	var capturedTargetType string
	var capturedTargetID uuid.UUID
	var capturedChanges map[string]interface{}

	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return &models.Subscription{ID: subID, TenantID: tenantID, Status: "trial"}, nil
		},
		updateSubscription: func(sub *models.Subscription) error { return nil },
		logAdminAction: func(_ uuid.UUID, _ string, targetType string, targetID uuid.UUID, changes interface{}, _, _ string) error {
			capturedTargetType = targetType
			capturedTargetID = targetID
			capturedChanges = changes.(map[string]interface{})
			return nil
		},
	}
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]string{"status": "active", "reason": "invoice #1042 paid"})
	req := httptest.NewRequest(http.MethodPatch, "/api/super-admin/tenants/"+tenantID.String()+"/subscription", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{UserID: adminID.String(), TenantID: uuid.New().String(), Role: "admin"})

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("UpdateTenantSubscription returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedTargetType != "tenant" {
		t.Fatalf("expected target_type=tenant, got %q", capturedTargetType)
	}
	if capturedTargetID != tenantID {
		t.Fatalf("expected target_id=%v (tenant), got %v", tenantID, capturedTargetID)
	}
	if capturedChanges["reason"] != "invoice #1042 paid" {
		t.Fatalf("expected reason in audit changes, got %#v", capturedChanges)
	}
	if capturedChanges["old"] == nil || capturedChanges["new"] == nil {
		t.Fatalf("expected old/new diff preserved alongside reason, got %#v", capturedChanges)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/... -run TestUpdateTenantSubscription -v`
Expected: FAIL — no `reason` validation exists yet, and `target_type` is still `"subscription"`.

- [ ] **Step 3: Implement**

In `backend/internal/handler/super_admin.go`, modify `UpdateTenantSubscription`'s request struct and add validation right after `c.Bind`:

```go
	var req struct {
		PlanID         *string                 `json:"plan_id"`
		Status         *string                 `json:"status"`
		EndDate        *time.Time              `json:"end_date"`
		CustomLimits   *map[string]interface{} `json:"custom_limits"`
		CustomFeatures *map[string]interface{} `json:"custom_features"`
		AdminNotes     *string                 `json:"admin_notes"`
		Reason         string                  `json:"reason"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}
	if strings.TrimSpace(req.Reason) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "reason is required"})
	}
```

Add `"strings"` to the import block if not already present (it likely already is — `CreateTenantSuper` in the same file uses `strings.TrimSpace`).

Then change the `LogAdminAction` call at the end of the function (currently target_type=`"subscription"`, target_id=`sub.ID`):

```go
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, action, "tenant", tenantID, map[string]interface{}{
		"old":    oldSub,
		"new":    sub,
		"reason": req.Reason,
	}, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/... -run TestUpdateTenantSubscription -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Full backend gate and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...`
Expected: all pass. Also grep-verify no other code reads audit rows by `target_type="subscription"` before committing: `grep -rn 'target_type.*subscription\|"subscription".*target' backend/internal --include="*.go"` should show only the line you just changed away from (confirms nothing downstream depends on the old shape).

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go
git commit -m "feat(backend): require reason on subscription updates, log audit as tenant-targeted"
```

---

### Task 3: Backend — mandatory `reason` for `ImpersonateTenant`

**Files:**
- Modify: `backend/internal/handler/super_admin.go:436-486` (`ImpersonateTenant`)
- Test: `backend/internal/handler/super_admin_test.go` (append)

**Interfaces:**
- Consumes: existing `generateImpersonationToken(userID, tenantID string)`, existing `claimsFromContext`.
- Produces: `POST /tenants/:id/impersonate` now requires a non-empty `"reason"` (`400` `{"error": "reason is required"}` if absent/empty). Success response shape unchanged.

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/handler/super_admin_test.go`:

```go
func TestImpersonateTenant_ReasonRequired(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()

	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/impersonate", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("ImpersonateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reason is missing, got %d: %s", rec.Code, rec.Body.String())
	}
}
```

(`TestImpersonateTenant_ReasonPersistedToAuditChanges`, testing the success path with a reason present, already exists from Batch 1 — confirm with `grep -n "TestImpersonateTenant_ReasonPersisted" backend/internal/handler/super_admin_test.go` before writing a duplicate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler/... -run TestImpersonateTenant_ReasonRequired -v`
Expected: FAIL — currently a request with `{}` body succeeds (200), since `reason` is optional today.

- [ ] **Step 3: Implement**

In `backend/internal/handler/super_admin.go`, inside `ImpersonateTenant`, after the existing `c.Bind(&body)` (currently line ~454), add:

```go
	if strings.TrimSpace(body.Reason) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "reason is required"})
	}
```

Leave the rest of the function (status check, token mint, `LogAdminAction` call with `changes["reason"] = body.Reason`) unchanged — it already handles a present reason correctly from Batch 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/... -run TestImpersonateTenant -v`
Expected: PASS, all `TestImpersonateTenant_*` tests including the pre-existing one.

- [ ] **Step 5: Full backend gate and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...`
Expected: all pass.

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go
git commit -m "feat(backend): require reason on impersonation entry"
```

---

### Task 4: Frontend infra — `useScrollSpy` hook

**Files:**
- Create: `web/src/hooks/useScrollSpy.ts`
- Test: `web/src/hooks/__tests__/useScrollSpy.test.ts`

**Interfaces:**
- Consumes: nothing project-specific — plain DOM `IntersectionObserver`.
- Produces: `useScrollSpy(sectionIds: string[]): string` — returns the `id` of the currently most-visible section, defaulting to `sectionIds[0]`. Consumed by Task 10 (the anchor rail).

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/__tests__/useScrollSpy.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollSpy } from '../useScrollSpy';

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe('useScrollSpy', () => {
  let observerInstance: MockIntersectionObserver;

  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <div id="summary"></div>
        <div id="lifecycle"></div>
      </main>
    `;
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((cb: IntersectionObserverCallback) => {
        observerInstance = new MockIntersectionObserver(cb);
        return observerInstance;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the first section id', () => {
    const { result } = renderHook(() => useScrollSpy(['summary', 'lifecycle']));
    expect(result.current).toBe('summary');
  });

  it('updates to the section reported as intersecting', () => {
    const { result } = renderHook(() => useScrollSpy(['summary', 'lifecycle']));
    const lifecycleEl = document.getElementById('lifecycle')!;
    act(() => {
      observerInstance.callback(
        [{ isIntersecting: true, target: lifecycleEl } as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver
      );
    });
    expect(result.current).toBe('lifecycle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/hooks/__tests__/useScrollSpy.test.ts`
Expected: FAIL — `Cannot find module '../useScrollSpy'`.

- [ ] **Step 3: Implement**

Create `web/src/hooks/useScrollSpy.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Tracks which of the given section element IDs is currently most visible,
 * for driving an anchor rail's active-link highlight. Resolves its
 * IntersectionObserver root from the nearest scrolling <main> ancestor
 * (this app's page scroll container is <main class="overflow-auto">, not
 * window) rather than assuming viewport scrolling.
 */
export function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? '');

  useEffect(() => {
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const root = elements[0].closest('main');

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sectionIds is a stable literal array from the caller
  }, [sectionIds.join(',')]);

  return activeId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/hooks/__tests__/useScrollSpy.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/hooks/useScrollSpy.ts src/hooks/__tests__/useScrollSpy.test.ts && npx vitest run`
Expected: all pass.

```bash
git add web/src/hooks/useScrollSpy.ts web/src/hooks/__tests__/useScrollSpy.test.ts
git commit -m "feat(web): add useScrollSpy hook for the tenant detail anchor rail"
```

---

### Task 5: Frontend infra — audit diff/day-grouping utilities + `AuditEntryList` component

**Files:**
- Create: `web/src/lib/auditFormat.ts`
- Create: `web/src/components/AuditEntryList.tsx`
- Test: `web/src/lib/__tests__/auditFormat.test.ts`
- Test: `web/src/components/__tests__/AuditEntryList.test.tsx`

**Interfaces:**
- Consumes: nothing — pure functions/presentational component over plain data.
- Produces: `AuditLogEntry` type, `groupAuditLogByDay(entries: AuditLogEntry[]): AuditDayGroup[]`, `formatAuditDiff(entry: AuditLogEntry, planNames?: Record<string, string>): string`, and `<AuditEntryList entries={AuditLogEntry[]} planNames?={Record<string,string>} emptyLabel={string} />`. Consumed by Task 10's Subscription change-feed and Task 12's Activity section — and intended for reuse, unmodified, by Batch 3's global Audit Log page.

- [ ] **Step 1: Write the failing utility tests**

Create `web/src/lib/__tests__/auditFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupAuditLogByDay, formatAuditDiff, type AuditLogEntry } from '../auditFormat';

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: '1',
    admin_user_id: 'admin-1',
    action: 'suspend_tenant',
    target_type: 'tenant',
    target_id: 'tenant-1',
    changes: {},
    ip_address: null,
    user_agent: null,
    created_at: '2026-07-11T10:00:00Z',
    ...overrides,
  };
}

describe('groupAuditLogByDay', () => {
  it('groups entries by their created_at date, preserving order within a day', () => {
    const entries = [
      entry({ id: '1', created_at: '2026-07-11T10:00:00Z' }),
      entry({ id: '2', created_at: '2026-07-11T09:00:00Z' }),
      entry({ id: '3', created_at: '2026-07-10T10:00:00Z' }),
    ];
    const groups = groupAuditLogByDay(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ day: '2026-07-11', entries: [entries[0], entries[1]] });
    expect(groups[1]).toEqual({ day: '2026-07-10', entries: [entries[2]] });
  });
});

describe('formatAuditDiff', () => {
  it('renders lifecycle transitions with reason', () => {
    const line = formatAuditDiff(entry({ action: 'suspend_tenant', changes: { from: 'active', to: 'suspended', reason: 'nonpayment' } }));
    expect(line).toBe('Status: active → suspended — reason: nonpayment');
  });

  it('renders lifecycle transitions without reason', () => {
    const line = formatAuditDiff(entry({ action: 'archive_tenant', changes: { from: 'suspended', to: 'archived' } }));
    expect(line).toBe('Status: suspended → archived');
  });

  it('renders impersonated_request as method + path', () => {
    const line = formatAuditDiff(entry({ action: 'impersonated_request', changes: { method: 'PATCH', path: '/api/events/123' } }));
    expect(line).toBe('PATCH /api/events/123');
  });

  it('renders subscription plan changes using the planNames lookup', () => {
    const line = formatAuditDiff(
      entry({
        action: 'update_subscription',
        changes: {
          old: { plan_id: 'plan-starter', status: 'trial' },
          new: { plan_id: 'plan-pro', status: 'active' },
          reason: 'invoice #1042',
        },
      }),
      { 'plan-starter': 'Starter', 'plan-pro': 'Professional' }
    );
    expect(line).toBe('Plan: Starter → Professional; Status: trial → active — reason: invoice #1042');
  });

  it('falls back to a generic label when nothing in the subscription diff changed', () => {
    const line = formatAuditDiff(
      entry({ action: 'update_subscription', changes: { old: { status: 'active' }, new: { status: 'active' }, reason: 'note only' } })
    );
    expect(line).toBe('Subscription updated — reason: note only');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/__tests__/auditFormat.test.ts`
Expected: FAIL — `Cannot find module '../auditFormat'`.

- [ ] **Step 3: Implement the utilities**

Create `web/src/lib/auditFormat.ts`:

```ts
export type AuditLogEntry = {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type AuditDayGroup = { day: string; entries: AuditLogEntry[] };

/** Groups by the entry's created_at calendar date (UTC, YYYY-MM-DD), preserving API order (newest-first) within each day. */
export function groupAuditLogByDay(entries: AuditLogEntry[]): AuditDayGroup[] {
  const order: string[] = [];
  const groups = new Map<string, AuditLogEntry[]>();
  for (const entry of entries) {
    const day = entry.created_at.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(day, [entry]);
      order.push(day);
    }
  }
  return order.map((day) => ({ day, entries: groups.get(day)! }));
}

function shortId(id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 8) : 'none';
}

/** Human-readable one-line description of a single audit entry's diff. */
export function formatAuditDiff(entry: AuditLogEntry, planNames?: Record<string, string>): string {
  const c = entry.changes ?? {};
  const reasonSuffix = typeof c.reason === 'string' && c.reason ? ` — reason: ${c.reason}` : '';

  switch (entry.action) {
    case 'suspend_tenant':
    case 'reactivate_tenant':
    case 'archive_tenant': {
      const from = typeof c.from === 'string' ? c.from : '?';
      const to = typeof c.to === 'string' ? c.to : '?';
      return `Status: ${from} → ${to}${reasonSuffix}`;
    }
    case 'impersonate_tenant':
      return `Support session started${reasonSuffix}`;
    case 'impersonated_request': {
      const method = typeof c.method === 'string' ? c.method : '';
      const path = typeof c.path === 'string' ? c.path : '';
      return `${method} ${path}`.trim();
    }
    case 'update_subscription':
    case 'create_subscription': {
      const oldSub = (c.old ?? {}) as Record<string, unknown>;
      const newSub = (c.new ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      const resolvePlan = (id: unknown) => (planNames?.[id as string] ?? shortId(id));
      if (oldSub.plan_id !== newSub.plan_id) {
        parts.push(`Plan: ${resolvePlan(oldSub.plan_id)} → ${resolvePlan(newSub.plan_id)}`);
      }
      if (oldSub.status !== newSub.status) {
        parts.push(`Status: ${oldSub.status ?? '?'} → ${newSub.status ?? '?'}`);
      }
      if (JSON.stringify(oldSub.custom_limits ?? {}) !== JSON.stringify(newSub.custom_limits ?? {})) {
        parts.push('Custom limits updated');
      }
      if (parts.length === 0) parts.push('Subscription updated');
      return parts.join('; ') + reasonSuffix;
    }
    case 'create_tenant':
      return 'Tenant created';
    default:
      return entry.action.replace(/_/g, ' ');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/__tests__/auditFormat.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing component test**

Create `web/src/components/__tests__/AuditEntryList.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditEntryList } from '../AuditEntryList';
import type { AuditLogEntry } from '@/lib/auditFormat';
import '../../i18n';

const entries: AuditLogEntry[] = [
  {
    id: '1',
    admin_user_id: 'admin-1',
    action: 'suspend_tenant',
    target_type: 'tenant',
    target_id: 'tenant-1',
    changes: { from: 'active', to: 'suspended' },
    ip_address: null,
    user_agent: null,
    created_at: '2026-07-11T10:00:00Z',
  },
];

describe('AuditEntryList', () => {
  it('renders a day-group heading and the formatted diff line', () => {
    render(<AuditEntryList entries={entries} emptyLabel="No activity" />);
    expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument();
  });

  it('renders the empty label when there are no entries', () => {
    render(<AuditEntryList entries={[]} emptyLabel="No activity yet" />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/AuditEntryList.test.tsx`
Expected: FAIL — `Cannot find module '../AuditEntryList'`.

- [ ] **Step 7: Implement the component**

Create `web/src/components/AuditEntryList.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { groupAuditLogByDay, formatAuditDiff, type AuditLogEntry } from '@/lib/auditFormat';

const ACTION_BADGE_CLASS: Record<string, string> = {
  suspend_tenant: 'bg-amber-500 text-black',
  archive_tenant: 'bg-muted text-muted-foreground',
  reactivate_tenant: 'bg-primary text-primary-foreground',
  impersonate_tenant: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  impersonated_request: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
};

type Props = {
  entries: AuditLogEntry[];
  planNames?: Record<string, string>;
  emptyLabel: string;
};

export function AuditEntryList({ entries, planNames, emptyLabel }: Props) {
  const { i18n } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const groups = groupAuditLogByDay(entries);
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.day}>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {new Date(group.day).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })}
          </h4>
          <ul className="space-y-2">
            {group.entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
                <Badge
                  className={ACTION_BADGE_CLASS[entry.action] ?? ''}
                  variant={ACTION_BADGE_CLASS[entry.action] ? undefined : 'outline'}
                >
                  {entry.action.replace(/_/g, ' ')}
                </Badge>
                <div className="flex-1">
                  <p>{formatAuditDiff(entry, planNames)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/AuditEntryList.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/lib/auditFormat.ts src/components/AuditEntryList.tsx src/lib/__tests__/auditFormat.test.ts src/components/__tests__/AuditEntryList.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/lib/auditFormat.ts web/src/components/AuditEntryList.tsx web/src/lib/__tests__/auditFormat.test.ts web/src/components/__tests__/AuditEntryList.test.tsx
git commit -m "feat(web): add audit diff/day-grouping utilities and AuditEntryList component"
```

---

### Task 6: Frontend infra — `TenantIdentityHeader` component + `useTypedConfirmGate` hook

**Files:**
- Create: `web/src/components/TenantIdentityHeader.tsx`
- Create: `web/src/hooks/useTypedConfirmGate.ts`
- Test: `web/src/components/__tests__/TenantIdentityHeader.test.tsx`
- Test: `web/src/hooks/__tests__/useTypedConfirmGate.test.ts`

**Interfaces:**
- Consumes: existing `StatusBadge` (`web/src/components/StatusBadge.tsx`), existing `Badge` (`web/src/components/ui/badge.tsx`).
- Produces: `<TenantIdentityHeader name={string} status?={string} planName?={string} />` — consumed by Task 10 (page assembly). `useTypedConfirmGate(open: boolean, confirmText: string | undefined): { typed: string; setTyped: (v: string) => void; locked: boolean; requireText: boolean }` — the same fail-closed semantics as `ConfirmActionDialog` (extracted, not imported from it — see Global Constraints hard rule), consumed by Task 7 (`LifecycleActionDialog`) and Task 8 (`ArchiveSheet`).

- [ ] **Step 1: Write the failing hook test**

Create `web/src/hooks/__tests__/useTypedConfirmGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypedConfirmGate } from '../useTypedConfirmGate';

describe('useTypedConfirmGate', () => {
  it('is unlocked when confirmText is undefined (no typed-confirm required)', () => {
    const { result } = renderHook(() => useTypedConfirmGate(true, undefined));
    expect(result.current.locked).toBe(false);
    expect(result.current.requireText).toBe(false);
  });

  it('locks when confirmText is an empty string (fail closed, does not bypass)', () => {
    const { result } = renderHook(() => useTypedConfirmGate(true, ''));
    expect(result.current.locked).toBe(true);
  });

  it('unlocks only once typed matches confirmText exactly', () => {
    const { result } = renderHook(() => useTypedConfirmGate(true, 'Acme Corp'));
    expect(result.current.locked).toBe(true);
    act(() => result.current.setTyped('Acme Cor'));
    expect(result.current.locked).toBe(true);
    act(() => result.current.setTyped('Acme Corp'));
    expect(result.current.locked).toBe(false);
  });

  it('resets typed text when open transitions to true', () => {
    const { result, rerender } = renderHook(({ open }) => useTypedConfirmGate(open, 'X'), {
      initialProps: { open: false },
    });
    act(() => result.current.setTyped('X'));
    rerender({ open: true });
    expect(result.current.typed).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/hooks/__tests__/useTypedConfirmGate.test.ts`
Expected: FAIL — `Cannot find module '../useTypedConfirmGate'`.

- [ ] **Step 3: Implement the hook**

Create `web/src/hooks/useTypedConfirmGate.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Typed-confirm gating logic shared by LifecycleActionDialog and
 * ArchiveSheet. Mirrors ConfirmActionDialog's fail-closed semantics
 * (extracted, not imported — ConfirmActionDialog itself is never modified):
 * an empty-string confirmText LOCKS the gate rather than bypassing it.
 */
export function useTypedConfirmGate(open: boolean, confirmText: string | undefined) {
  const [typed, setTyped] = useState('');
  const requireText = confirmText !== undefined;
  const locked = requireText && (confirmText === '' || typed !== confirmText);

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  return { typed, setTyped, locked, requireText };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/hooks/__tests__/useTypedConfirmGate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing component test**

Create `web/src/components/__tests__/TenantIdentityHeader.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TenantIdentityHeader } from '../TenantIdentityHeader';
import '../../i18n';

describe('TenantIdentityHeader', () => {
  it('renders the tenant name, status badge, and plan badge', () => {
    render(<TenantIdentityHeader name="Acme Corp" status="suspended" planName="Professional" />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('Professional')).toBeInTheDocument();
  });

  it('omits the plan badge when planName is not given', () => {
    render(<TenantIdentityHeader name="Acme Corp" status="active" />);
    expect(screen.queryByText('Professional')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/TenantIdentityHeader.test.tsx`
Expected: FAIL — `Cannot find module '../TenantIdentityHeader'`.

- [ ] **Step 7: Implement the component**

Create `web/src/components/TenantIdentityHeader.tsx`:

```tsx
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';

type Props = {
  name: string;
  status?: string;
  planName?: string;
};

/**
 * Persistent tenant-identity strip pinned above every Tenant Detail
 * section, so the operator always knows whose account they're touching
 * (design brief's "wrong-tenant safety" requirement).
 */
export function TenantIdentityHeader({ name, status, planName }: Props) {
  return (
    <div className="sticky top-0 z-10 -mx-8 mb-6 flex items-center gap-3 border-b border-border bg-background/95 px-8 py-4 backdrop-blur">
      <h1 className="text-xl font-bold">{name}</h1>
      <StatusBadge status={status} />
      {planName && <Badge variant="outline">{planName}</Badge>}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/TenantIdentityHeader.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/TenantIdentityHeader.tsx src/hooks/useTypedConfirmGate.ts src/components/__tests__/TenantIdentityHeader.test.tsx src/hooks/__tests__/useTypedConfirmGate.test.ts && npx vitest run`
Expected: all pass.

```bash
git add web/src/components/TenantIdentityHeader.tsx web/src/hooks/useTypedConfirmGate.ts web/src/components/__tests__/TenantIdentityHeader.test.tsx web/src/hooks/__tests__/useTypedConfirmGate.test.ts
git commit -m "feat(web): add TenantIdentityHeader and useTypedConfirmGate"
```

---

### Task 7: `SuspendTenantDialog` component (modal, checkbox acknowledgment + typed confirm)

**Files:**
- Create: `web/src/components/SuspendTenantDialog.tsx`
- Modify: `web/src/i18n.ts` (add keys — see Step 3)
- Test: `web/src/components/__tests__/SuspendTenantDialog.test.tsx`

**Interfaces:**
- Consumes: `useTypedConfirmGate` (Task 6), `Dialog`/`DialogContent`/`DialogDescription`/`DialogFooter`/`DialogHeader`/`DialogTitle` (existing `web/src/components/ui/dialog.tsx`), `Checkbox` (existing `web/src/components/ui/checkbox.tsx`).
- Produces: `<SuspendTenantDialog open tenantName usersCount eventsCount onConfirm={(reason: string) => void|Promise<void>} busy onOpenChange />`. Consumed by Task 11 (Lifecycle section).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/SuspendTenantDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuspendTenantDialog } from '../SuspendTenantDialog';
import '../../i18n';

describe('SuspendTenantDialog', () => {
  it('keeps confirm disabled until BOTH the checkbox is checked AND the tenant name is typed', () => {
    render(
      <SuspendTenantDialog
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={() => {}}
        busy={false}
      />
    );
    const confirmButton = screen.getByRole('button', { name: /suspend/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmButton).toBeDisabled(); // checkbox alone is not enough

    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = vi.fn();
    render(
      <SuspendTenantDialog
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={onConfirm}
        busy={false}
      />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    const [reasonBox] = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(reasonBox, { target: { value: 'nonpayment' } });
    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));
    expect(onConfirm).toHaveBeenCalledWith('nonpayment');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/SuspendTenantDialog.test.tsx`
Expected: FAIL — `Cannot find module '../SuspendTenantDialog'`.

- [ ] **Step 3: Add i18n keys**

In `web/src/i18n.ts`, in the `en.translation` block, immediately after the existing `lifecycle_archive_done: "Organization archived",` line, add:

```ts
          td_suspend_title: "Suspend organization?",
          td_suspend_consequence: "This affects {{users}} users and {{events}} events for “{{tenant}}”. All API access will be blocked within ~2 minutes.",
          td_suspend_acknowledge: "I understand this blocks access for this organization's users immediately.",
          td_reasonOptionalLabel: "Reason (optional, visible in the audit log)",
```

In the `ru.translation` block, find the matching `lifecycle_archive_done:` line (same relative position) and add immediately after it:

```ts
          td_suspend_title: "Приостановить организацию?",
          td_suspend_consequence: "Это затронет {{users}} пользователей и {{events}} мероприятий «{{tenant}}». Доступ к API будет заблокирован в течение ~2 минут.",
          td_suspend_acknowledge: "Я понимаю, что это немедленно заблокирует доступ для пользователей этой организации.",
          td_reasonOptionalLabel: "Причина (необязательно, отображается в журнале аудита)",
```

(Locate the `ru` block's `lifecycle_archive_done` line first with `grep -n "lifecycle_archive_done" web/src/i18n.ts` — it must appear twice, once per language block; add after the second occurrence.)

- [ ] **Step 4: Implement the component**

Create `web/src/components/SuspendTenantDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTypedConfirmGate } from '@/hooks/useTypedConfirmGate';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantName: string;
  usersCount: number;
  eventsCount: number;
  onConfirm: (reason: string) => void | Promise<void>;
  busy: boolean;
};

export function SuspendTenantDialog({ open, onOpenChange, tenantName, usersCount, eventsCount, onConfirm, busy }: Props) {
  const { t } = useTranslation();
  const { typed, setTyped, locked } = useTypedConfirmGate(open, tenantName);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');

  const close = (o: boolean) => {
    if (!o) {
      setAcknowledged(false);
      setReason('');
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('td_suspend_title')}</DialogTitle>
          <DialogDescription>
            {t('td_suspend_consequence', { tenant: tenantName, users: usersCount, events: eventsCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2">
          <Checkbox id="suspend-ack" checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
          <Label htmlFor="suspend-ack" className="text-sm font-normal leading-snug">
            {t('td_suspend_acknowledge')}
          </Label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="suspend-reason">{t('td_reasonOptionalLabel')}</Label>
          <Textarea id="suspend-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: tenantName })}</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tenantName} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button variant="destructive" disabled={locked || !acknowledged || busy} onClick={() => onConfirm(reason)}>
            {t('lifecycle_suspend_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/SuspendTenantDialog.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/SuspendTenantDialog.tsx src/i18n.ts src/components/__tests__/SuspendTenantDialog.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/components/SuspendTenantDialog.tsx web/src/i18n.ts web/src/components/__tests__/SuspendTenantDialog.test.tsx
git commit -m "feat(web): add SuspendTenantDialog with checkbox-gated typed confirm"
```

---

### Task 8: `ArchiveSheet` component (side-sheet, dual checkbox acknowledgment + typed confirm)

**Files:**
- Create: `web/src/components/ArchiveSheet.tsx`
- Modify: `web/src/i18n.ts` (add keys — see Step 3)
- Test: `web/src/components/__tests__/ArchiveSheet.test.tsx`

**Interfaces:**
- Consumes: `useTypedConfirmGate` (Task 6), `Sheet`/`SheetContent`/`SheetDescription`/`SheetFooter`/`SheetHeader`/`SheetTitle` (existing `web/src/components/ui/sheet.tsx`, unused since Batch 1).
- Produces: `<ArchiveSheet open tenantName usersCount eventsCount onConfirm={(reason: string) => void|Promise<void>} busy onOpenChange />`. Consumed by Task 11 (Lifecycle section).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/ArchiveSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArchiveSheet } from '../ArchiveSheet';
import '../../i18n';

describe('ArchiveSheet', () => {
  it('keeps confirm disabled until both checkboxes are checked and the tenant name is typed', () => {
    render(
      <ArchiveSheet
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={() => {}}
        busy={false}
      />
    );
    const confirmButton = screen.getByRole('button', { name: /archive/i });
    expect(confirmButton).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(confirmButton).toBeDisabled(); // only one of two acknowledgments

    fireEvent.click(checkboxes[1]);
    expect(confirmButton).toBeDisabled(); // both checked, but name not typed yet

    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = vi.fn();
    render(
      <ArchiveSheet
        open
        onOpenChange={() => {}}
        tenantName="Acme Corp"
        usersCount={4}
        eventsCount={2}
        onConfirm={onConfirm}
        busy={false}
      />
    );
    screen.getAllByRole('checkbox').forEach((cb) => fireEvent.click(cb));
    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    const [reasonBox] = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(reasonBox, { target: { value: 'contract ended' } });
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(onConfirm).toHaveBeenCalledWith('contract ended');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/ArchiveSheet.test.tsx`
Expected: FAIL — `Cannot find module '../ArchiveSheet'`.

- [ ] **Step 3: Add i18n keys**

In `web/src/i18n.ts`, `en.translation` block, immediately after the `td_reasonOptionalLabel` line added in Task 7, add:

```ts
          td_archive_title: "Archive organization?",
          td_archive_consequence: "This affects {{users}} users and {{events}} events for “{{tenant}}”. The organization becomes read-blocked and enters the retention-cleanup countdown.",
          td_archive_acknowledgeRetention: "I understand this starts an irreversible retention-cleanup countdown.",
          td_archive_acknowledgeIrreversible: "I understand this cannot be undone from the UI.",
```

`ru.translation` block, same relative position (after the `ru` `td_reasonOptionalLabel` line from Task 7):

```ts
          td_archive_title: "Архивировать организацию?",
          td_archive_consequence: "Это затронет {{users}} пользователей и {{events}} мероприятий «{{tenant}}». Организация будет заблокирована для чтения и запустится необратимый отсчёт хранения данных.",
          td_archive_acknowledgeRetention: "Я понимаю, что это запускает необратимый отсчёт хранения данных.",
          td_archive_acknowledgeIrreversible: "Я понимаю, что это действие нельзя отменить через интерфейс.",
```

- [ ] **Step 4: Implement the component**

Create `web/src/components/ArchiveSheet.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTypedConfirmGate } from '@/hooks/useTypedConfirmGate';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantName: string;
  usersCount: number;
  eventsCount: number;
  onConfirm: (reason: string) => void | Promise<void>;
  busy: boolean;
};

export function ArchiveSheet({ open, onOpenChange, tenantName, usersCount, eventsCount, onConfirm, busy }: Props) {
  const { t } = useTranslation();
  const { typed, setTyped, locked } = useTypedConfirmGate(open, tenantName);
  const [ackRetention, setAckRetention] = useState(false);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [reason, setReason] = useState('');

  const close = (o: boolean) => {
    if (!o) {
      setAckRetention(false);
      setAckIrreversible(false);
      setReason('');
    }
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('td_archive_title')}</SheetTitle>
          <SheetDescription>
            {t('td_archive_consequence', { tenant: tenantName, users: usersCount, events: eventsCount })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox id="archive-ack-retention" checked={ackRetention} onCheckedChange={(v) => setAckRetention(v === true)} />
            <Label htmlFor="archive-ack-retention" className="text-sm font-normal leading-snug">
              {t('td_archive_acknowledgeRetention')}
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="archive-ack-irreversible" checked={ackIrreversible} onCheckedChange={(v) => setAckIrreversible(v === true)} />
            <Label htmlFor="archive-ack-irreversible" className="text-sm font-normal leading-snug">
              {t('td_archive_acknowledgeIrreversible')}
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="archive-reason">{t('td_reasonOptionalLabel')}</Label>
          <Textarea id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('typeToConfirm', { text: tenantName })}</p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tenantName} />
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button
            variant="destructive"
            disabled={locked || !ackRetention || !ackIrreversible || busy}
            onClick={() => onConfirm(reason)}
          >
            {t('lifecycle_archive_confirm')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/ArchiveSheet.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/ArchiveSheet.tsx src/i18n.ts src/components/__tests__/ArchiveSheet.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/components/ArchiveSheet.tsx web/src/i18n.ts web/src/components/__tests__/ArchiveSheet.test.tsx
git commit -m "feat(web): add ArchiveSheet with dual-checkbox-gated typed confirm"
```

---

### Task 9: Impersonation ceremony — mandatory-reason entry dialog + exit summary

**Files:**
- Create: `web/src/components/ImpersonateDialog.tsx`
- Create: `web/src/lib/impersonationSummary.ts`
- Modify: `web/src/lib/impersonation.ts` (add `mintedAt` to session, `getParkedOperatorToken`, `destination` param on `endImpersonation`)
- Modify: `web/src/components/ImpersonationBanner.tsx` (exit now shows the summary before navigating away)
- Modify: `web/src/i18n.ts` (add keys)
- Test: `web/src/components/__tests__/ImpersonateDialog.test.tsx`
- Test: `web/src/lib/__tests__/impersonation.test.ts` (create if missing)
- Test: `web/src/components/__tests__/ImpersonationBanner.test.tsx` (extend the exit-summary path)

**Interfaces:**
- Consumes: nothing new from earlier Batch 2 tasks.
- Produces: `<ImpersonateDialog open tenantName onConfirm={(reason: string) => void|Promise<void>} busy onOpenChange />` (consumed by Task 11). `ImpersonationSession` gains `mintedAt: string` (backward compatible — `startImpersonation`'s public signature is unchanged, it stamps `mintedAt` internally). `getParkedOperatorToken(): string | null`. `endImpersonation(destination?: string): void` (default unchanged). `fetchImpersonationSummary(tenantId: string, mintedAt: string, operatorToken: string): Promise<{durationMinutes: number; actionCount: number}>`.

- [ ] **Step 1: Write the failing `ImpersonateDialog` test**

Create `web/src/components/__tests__/ImpersonateDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImpersonateDialog } from '../ImpersonateDialog';
import '../../i18n';

describe('ImpersonateDialog', () => {
  it('keeps confirm disabled until a reason is typed', () => {
    render(<ImpersonateDialog open onOpenChange={() => {}} tenantName="Acme Corp" onConfirm={() => {}} busy={false} />);
    const confirmButton = screen.getByRole('button', { name: /start session/i });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'customer requested help debugging check-in' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the typed reason', () => {
    const onConfirm = vi.fn();
    render(<ImpersonateDialog open onOpenChange={() => {}} tenantName="Acme Corp" onConfirm={onConfirm} busy={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'support ticket #42' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    expect(onConfirm).toHaveBeenCalledWith('support ticket #42');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/ImpersonateDialog.test.tsx`
Expected: FAIL — `Cannot find module '../ImpersonateDialog'`.

- [ ] **Step 3: Add i18n keys**

`en.translation`, immediately after Task 8's `td_archive_acknowledgeIrreversible` line:

```ts
          td_reasonRequiredLabel: "Reason (required, visible in the audit log)",
          td_impersonateReasonPlaceholder: "e.g. support ticket #42, customer can't create events",
          td_exitSummaryTitle: "Exited “{{tenant}}”",
          td_exitSummaryBody: "You were in this organization for {{minutes}} min and made {{count}} changes.",
          td_exitSummaryUnavailable: "Session ended. Activity summary is unavailable right now.",
          td_exitSummaryViewActivity: "View activity log",
```

`ru.translation`, same relative position:

```ts
          td_reasonRequiredLabel: "Причина (обязательно, отображается в журнале аудита)",
          td_impersonateReasonPlaceholder: "например, тикет поддержки №42, клиент не может создать мероприятие",
          td_exitSummaryTitle: "Сессия в «{{tenant}}» завершена",
          td_exitSummaryBody: "Вы находились в этой организации {{minutes}} мин и внесли {{count}} изменений.",
          td_exitSummaryUnavailable: "Сессия завершена. Сводка активности сейчас недоступна.",
          td_exitSummaryViewActivity: "Открыть журнал активности",
```

- [ ] **Step 4: Implement `ImpersonateDialog`**

Create `web/src/components/ImpersonateDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantName: string;
  onConfirm: (reason: string) => void | Promise<void>;
  busy: boolean;
};

export function ImpersonateDialog({ open, onOpenChange, tenantName, onConfirm, busy }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  const close = (o: boolean) => {
    if (!o) setReason('');
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('impersonateTitle')}</DialogTitle>
          <DialogDescription>{t('impersonateDescription', { tenant: tenantName })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="impersonate-reason">{t('td_reasonRequiredLabel')}</Label>
          <Textarea
            id="impersonate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('td_impersonateReasonPlaceholder')}
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>{t('cancel')}</Button>
          <Button disabled={reason.trim() === '' || busy} onClick={() => onConfirm(reason)}>
            {t('impersonateConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/ImpersonateDialog.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Write the failing `impersonation.ts` additions test**

Create `web/src/lib/__tests__/impersonation.test.ts` (or extend it if a file already exists — check first with `ls web/src/lib/__tests__/impersonation.test.ts`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startImpersonation, getImpersonation, getParkedOperatorToken } from '../impersonation';

describe('impersonation session mintedAt + parked token', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'operator-token-abc');
  });

  it('stamps mintedAt automatically and parks the operator token, without requiring callers to pass it', () => {
    const before = Date.now();
    startImpersonation('imp-token-xyz', {
      tenantId: 't1',
      tenantName: 'Acme Corp',
      expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
    });
    const session = getImpersonation();
    expect(session).not.toBeNull();
    expect(new Date(session!.mintedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(getParkedOperatorToken()).toBe('operator-token-abc');
  });
});
```

(`window.location.href = ...` inside `startImpersonation` will throw a jsdom "not implemented" navigation error in this test environment — confirm the existing test setup already tolerates this, since `Organizations.test.tsx` and other tests don't call `startImpersonation`. If the test fails on navigation rather than on the assertions, wrap the call in `try { ... } catch {}` inside the test, since only the localStorage side effects are under test here, not real navigation.)

- [ ] **Step 7: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/impersonation.test.ts`
Expected: FAIL — `getParkedOperatorToken` is not exported, `session.mintedAt` is `undefined`.

- [ ] **Step 8: Implement the `impersonation.ts` additions**

Modify `web/src/lib/impersonation.ts` — change the type and `startImpersonation`, and add two exports:

```ts
export type ImpersonationSession = {
  tenantId: string;
  tenantName: string;
  expiresAt: string; // ISO from the mint response
  mintedAt: string; // ISO, stamped locally at the moment startImpersonation runs
};

const OPERATOR_TOKEN_KEY = 'operator_token';
const SESSION_KEY = 'impersonation';

export function startImpersonation(token: string, session: Omit<ImpersonationSession, 'mintedAt'>): void {
  const operatorToken = localStorage.getItem('token');
  if (operatorToken) {
    localStorage.setItem(OPERATOR_TOKEN_KEY, operatorToken);
  }
  localStorage.setItem('token', token);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, mintedAt: new Date().toISOString() }));
  window.location.href = '/dashboard';
}

/** The operator's own token, parked while an impersonation token is active — used to make authenticated requests as the operator without ending the session (e.g. the exit-summary fetch). */
export function getParkedOperatorToken(): string | null {
  return localStorage.getItem(OPERATOR_TOKEN_KEY);
}
```

Change `endImpersonation` to accept an optional destination (default unchanged):

```ts
export function endImpersonation(destination = '/super-admin/organizations'): void {
  clearSession(true);
  window.location.href = destination;
}
```

Leave `clearSession`, `clearImpersonationArtifacts`, and `getImpersonation` untouched.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/impersonation.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 10: Implement `fetchImpersonationSummary`**

Create `web/src/lib/impersonationSummary.ts`:

```ts
import axios from 'axios';

export type ImpersonationSummary = {
  durationMinutes: number;
  actionCount: number;
};

/**
 * Fetches the exit summary for an impersonation session, authenticating
 * with the parked OPERATOR token directly (not the shared `api` client,
 * whose active token during a session is the impersonation token — this
 * call must succeed regardless of that token's own super-admin resolution).
 */
export async function fetchImpersonationSummary(
  tenantId: string,
  mintedAt: string,
  operatorToken: string
): Promise<ImpersonationSummary> {
  const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8008';
  const { data } = await axios.get(`${baseURL}/api/super-admin/audit-log`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
    params: { target_id: tenantId, action: 'impersonated_request' },
  });
  const entries: Array<{ created_at: string }> = data.logs ?? [];
  const since = new Date(mintedAt).getTime();
  const relevant = entries.filter((e) => new Date(e.created_at).getTime() >= since);
  const durationMinutes = Math.max(0, Math.round((Date.now() - since) / 60000));
  return { durationMinutes, actionCount: relevant.length };
}
```

- [ ] **Step 11: Write the failing `ImpersonationBanner` exit-summary test**

Create `web/src/components/__tests__/ImpersonationBanner.test.tsx` (extend if it already exists — check with `ls web/src/components/__tests__/ImpersonationBanner.test.tsx` first):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImpersonationBanner } from '../ImpersonationBanner';
import '../../i18n';

vi.mock('axios', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { logs: [{ created_at: new Date().toISOString() }] } }) },
}));

describe('ImpersonationBanner exit summary', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('operator_token', 'operator-token-abc');
    localStorage.setItem(
      'impersonation',
      JSON.stringify({
        tenantId: 't1',
        tenantName: 'Acme Corp',
        expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
        mintedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      })
    );
  });

  it('shows a fetched summary before the operator confirms exit', async () => {
    render(<ImpersonationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /exit session/i }));
    await waitFor(() => expect(screen.getByText(/made 1 changes/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/ImpersonationBanner.test.tsx`
Expected: FAIL — clicking exit navigates immediately today, no summary dialog exists.

- [ ] **Step 13: Implement the banner's exit-summary dialog**

Replace `web/src/components/ImpersonationBanner.tsx` in full:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { getImpersonation, endImpersonation, getParkedOperatorToken, type ImpersonationSession } from '@/lib/impersonation';
import { fetchImpersonationSummary, type ImpersonationSummary } from '@/lib/impersonationSummary';

/**
 * Unmissable support-session banner: shown on every page while an
 * impersonation token is active. Counts down; exiting shows a duration +
 * action-count summary before the operator confirms leaving (design
 * brief's impersonation-as-a-ceremony requirement).
 */
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [summary, setSummary] = useState<ImpersonationSummary | null>(null);

  useEffect(() => {
    const tick = () => {
      const s = getImpersonation(); // self-cleans on expiry
      setSession(s);
      if (s) {
        setMinutesLeft(Math.max(0, Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 60000)));
        document.documentElement.style.setProperty('--imp-banner-h', '40px');
      } else {
        document.documentElement.style.setProperty('--imp-banner-h', '0px');
      }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => {
      clearInterval(id);
      document.documentElement.style.setProperty('--imp-banner-h', '0px');
    };
  }, []);

  if (!session) return null;

  const startExit = async () => {
    setExiting(true);
    const operatorToken = getParkedOperatorToken();
    if (!operatorToken) return; // no summary possible; dialog still shows the unavailable copy
    try {
      const result = await fetchImpersonationSummary(session.tenantId, session.mintedAt, operatorToken);
      setSummary(result);
    } catch {
      setSummary(null); // fail open: never block exit on a failed summary fetch
    }
  };

  return (
    <>
      <div className="sticky top-0 z-[60] flex h-10 items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
        <span>
          {t('impersonationBanner', { tenant: session.tenantName, minutes: minutesLeft })}
        </span>
        <Button size="sm" variant="outline" className="h-7 border-black/30 bg-transparent text-black hover:bg-black/10" onClick={startExit}>
          {t('impersonationExit')}
        </Button>
      </div>
      <Dialog open={exiting} onOpenChange={(open) => !open && setExiting(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('td_exitSummaryTitle', { tenant: session.tenantName })}</DialogTitle>
            <DialogDescription>
              {summary
                ? t('td_exitSummaryBody', { minutes: summary.durationMinutes, count: summary.actionCount })
                : t('td_exitSummaryUnavailable')}
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="outline"
            onClick={() => endImpersonation(`/super-admin/organizations/${session.tenantId}#activity`)}
          >
            {t('td_exitSummaryViewActivity')}
          </Button>
          <DialogFooter>
            <Button onClick={() => endImpersonation()}>{t('impersonationExit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/ImpersonationBanner.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 15: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/ImpersonateDialog.tsx src/components/ImpersonationBanner.tsx src/lib/impersonation.ts src/lib/impersonationSummary.ts src/i18n.ts src/components/__tests__/ImpersonateDialog.test.tsx src/lib/__tests__/impersonation.test.ts src/components/__tests__/ImpersonationBanner.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/components/ImpersonateDialog.tsx web/src/components/ImpersonationBanner.tsx web/src/lib/impersonation.ts web/src/lib/impersonationSummary.ts web/src/i18n.ts web/src/components/__tests__/ImpersonateDialog.test.tsx web/src/lib/__tests__/impersonation.test.ts web/src/components/__tests__/ImpersonationBanner.test.tsx
git commit -m "feat(web): mandatory-reason impersonation entry dialog + exit summary"
```

---

### Task 10: `OrganizationDetail.tsx` — page skeleton, anchor rail, Summary + Subscription & Limits sections

**Files:**
- Modify (full rewrite): `web/src/pages/super-admin/OrganizationDetail.tsx`
- Modify: `web/src/i18n.ts` (add keys)
- Test: `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx` (new — no test exists for this page today)

**Interfaces:**
- Consumes: `TenantIdentityHeader` (Task 6), `useScrollSpy` (Task 4), `AuditEntryList` + `AuditLogEntry` (Task 5), existing `meterTone`/`meterToneClass` (`web/src/lib/meters.ts`), existing `resolvedLimit` (`web/src/lib/tenantQueues.ts`), the new `GET /audit-log?target_id=` filter (Task 1) and mandatory-`reason` `PATCH /subscription` (Task 2).
- Produces: the page fetches `auditEntries` (full tenant-scoped audit log, unfiltered by action) once in `loadData` — Tasks 11 and 12 reuse this same state rather than issuing new fetches. Section ids `summary` and `subscription` exist on the DOM for `useScrollSpy`; Tasks 11/12 add `lifecycle`, `users`, `activity`.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OrganizationDetail from '../OrganizationDetail';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

const mockStats = {
  tenant: { id: 't1', name: 'Acme Corp', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  subscription: { plan_id: 'plan-pro', status: 'active', plan: { name: 'Professional', limits: { users: 10 } } },
  users_count: 4,
  events_count: 2,
  attendees_count: 600,
};
const mockPlans = [{ id: 'plan-pro', name: 'Professional', price_monthly: 99 }];
const mockAudit = { logs: [] };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/super-admin/organizations/t1']}>
      <Routes>
        <Route path="/super-admin/organizations/:id" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OrganizationDetail — Summary + Subscription sections', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: mockStats });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      if (url.includes('/audit-log')) return Promise.resolve({ data: mockAudit });
      return Promise.reject(new Error('unexpected url ' + url));
    });
  });

  it('renders the tenant identity header and usage meters', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(screen.getByText('4 / 10')).toBeInTheDocument(); // users_count vs plan's users limit
  });

  it('keeps the subscription save button disabled until a reason is typed', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    const saveButton = screen.getByRole('button', { name: /update subscription/i });
    expect(saveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason \(required/i), { target: { value: 'invoice #1042' } });
    expect(saveButton).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`
Expected: FAIL — the current page has no reason field and no `4 / 10` meter text.

- [ ] **Step 3: Add i18n keys**

`en.translation`, immediately after Task 9's `td_exitSummaryViewActivity` line:

```ts
          td_nav_summary: "Summary",
          td_nav_subscription: "Subscription & Limits",
          td_subscriptionReasonPlaceholder: "e.g. invoice #1042 paid, upgraded per customer request",
          td_subscriptionHistory: "Change history",
          td_subscriptionHistoryEmpty: "No subscription changes yet.",
```

`ru.translation`, same relative position:

```ts
          td_nav_summary: "Сводка",
          td_nav_subscription: "Подписка и лимиты",
          td_subscriptionReasonPlaceholder: "например, счёт №1042 оплачен, тариф повышен по запросу клиента",
          td_subscriptionHistory: "История изменений",
          td_subscriptionHistoryEmpty: "Изменений подписки пока нет.",
```

- [ ] **Step 4: Implement — replace `web/src/pages/super-admin/OrganizationDetail.tsx` in full**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Users, Calendar, UserCheck } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { TenantIdentityHeader } from '@/components/TenantIdentityHeader';
import { AuditEntryList } from '@/components/AuditEntryList';
import { useScrollSpy } from '@/hooks/useScrollSpy';
import { meterTone, meterToneClass } from '@/lib/meters';
import { resolvedLimit } from '@/lib/tenantQueues';
import type { AuditLogEntry } from '@/lib/auditFormat';

interface TenantDetail {
  tenant?: { id?: string; name?: string; status?: string; website?: string; contact_email?: string; created_at?: string };
  subscription?: {
    plan_id?: string;
    status?: string;
    plan?: { name?: string; limits?: Record<string, number> };
    custom_limits?: Record<string, number> | null;
    admin_notes?: string;
  };
  users_count?: number;
  events_count?: number;
  attendees_count?: number;
}

type Plan = { id: string; name: string; price_monthly?: number };

const SECTIONS: Array<{ id: string; labelKey: string }> = [
  { id: 'summary', labelKey: 'td_nav_summary' },
  { id: 'subscription', labelKey: 'td_nav_subscription' },
];

export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [customLimits, setCustomLimits] = useState('{}');
  const [adminNotes, setAdminNotes] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [subscriptionReason, setSubscriptionReason] = useState('');

  const activeSection = useScrollSpy(SECTIONS.map((s) => s.id));

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when id changes
  }, [id]);

  const loadData = async () => {
    try {
      const [tenantResponse, plansResponse, auditResponse] = await Promise.all([
        api.get(`/api/super-admin/tenants/${id}/stats`),
        api.get('/api/super-admin/plans'),
        api.get(`/api/super-admin/audit-log?target_id=${id}&limit=100`),
      ]);

      setTenant(tenantResponse.data);
      setPlans(plansResponse.data);
      setAuditEntries(auditResponse.data.logs || []);

      if (tenantResponse.data.subscription) {
        const sub = tenantResponse.data.subscription;
        setSelectedPlanId(sub.plan_id || '');
        setCustomLimits(JSON.stringify(sub.custom_limits || {}, null, 2));
        setAdminNotes(sub.admin_notes || '');
        setSubscriptionStatus(sub.status);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error(t('error'), { description: t('failedToLoadData') });
    } finally {
      setLoading(false);
    }
  };

  const updateSubscription = async () => {
    if (subscriptionReason.trim() === '') return; // defense-in-depth; the button is also disabled
    try {
      setUpdating(true);
      let parsedLimits = {};
      try {
        parsedLimits = JSON.parse(customLimits);
      } catch {
        toast.error(t('error'), { description: t('invalidJSON') });
        return;
      }

      await api.patch(`/api/super-admin/tenants/${id}/subscription`, {
        plan_id: selectedPlanId || null,
        status: subscriptionStatus,
        custom_limits: parsedLimits,
        admin_notes: adminNotes,
        reason: subscriptionReason,
      });

      toast.success(t('success'), { description: t('subscriptionUpdated') });
      setSubscriptionReason('');
      loadData();
    } catch (error) {
      console.error('Failed to update subscription:', error);
      toast.error(t('error'), { description: t('failedToUpdateSubscription') });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">{t('tenantNotFound')}</p>
      </div>
    );
  }

  const planNames = Object.fromEntries(plans.map((p) => [p.id, p.name]));
  const subscriptionAudit = auditEntries.filter((e) => e.action === 'update_subscription' || e.action === 'create_subscription');

  return (
    <div className="flex gap-8 p-8">
      <nav className="sticky top-20 hidden w-48 shrink-0 self-start space-y-1 lg:block">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`block rounded-md px-3 py-1.5 text-sm ${
              activeSection === s.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {t(s.labelKey)}
          </a>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/super-admin/organizations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
        <TenantIdentityHeader
          name={tenant.tenant?.name ?? ''}
          status={tenant.tenant?.status}
          planName={tenant.subscription?.plan?.name}
        />

        <div className="space-y-10">
          <section id="summary">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_summary')}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {(
                [
                  ['users', Users, tenant.users_count ?? 0, resolvedLimit(tenant.subscription, 'users')],
                  ['events', Calendar, tenant.events_count ?? 0, resolvedLimit(tenant.subscription, 'events_per_month')],
                  ['attendees', UserCheck, tenant.attendees_count ?? 0, resolvedLimit(tenant.subscription, 'attendees_per_event')],
                ] as const
              ).map(([key, Icon, count, limit]) => {
                const tone = meterTone(count, limit);
                return (
                  <Card key={key}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">{t(key)}</CardTitle>
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className={`text-2xl font-bold ${meterToneClass(tone)}`}>
                        {count}
                        {limit !== -1 ? ` / ${limit}` : ''}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>{t('organizationInfo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{t('created')}</p>
                    <p className="font-medium">
                      {tenant.tenant?.created_at ? new Date(tenant.tenant.created_at).toLocaleString() : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('website')}</p>
                    <p className="font-medium">{tenant.tenant?.website || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('contactEmail')}</p>
                    <p className="font-medium">{tenant.tenant?.contact_email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t('tenantId')}</p>
                    <p className="font-mono text-xs">{tenant.tenant?.id}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="subscription">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_subscription')}</h2>
            <Card>
              <CardHeader>
                <CardTitle>{t('subscriptionManagement')}</CardTitle>
                <CardDescription>{t('subscriptionManagementDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('plan')}</Label>
                    <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('selectPlan')} />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name} - ${plan.price_monthly ?? 0}/mo
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('status')}</Label>
                    <Select value={subscriptionStatus} onValueChange={setSubscriptionStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{t('active')}</SelectItem>
                        <SelectItem value="trial">{t('trial')}</SelectItem>
                        <SelectItem value="expired">{t('expired')}</SelectItem>
                        <SelectItem value="cancelled">{t('cancelled')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('customLimits')}</Label>
                  <Textarea
                    placeholder='{"events_per_month": 100, "users": 50}'
                    value={customLimits}
                    onChange={(e) => setCustomLimits(e.target.value)}
                    rows={6}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{t('customLimitsHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label>{t('adminNotes')}</Label>
                  <Textarea
                    placeholder={t('internalNotesPlaceholder')}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subscription-reason">{t('td_reasonRequiredLabel')}</Label>
                  <Textarea
                    id="subscription-reason"
                    value={subscriptionReason}
                    onChange={(e) => setSubscriptionReason(e.target.value)}
                    placeholder={t('td_subscriptionReasonPlaceholder')}
                    rows={2}
                  />
                </div>

                <Button onClick={updateSubscription} disabled={updating || subscriptionReason.trim() === ''}>
                  {updating ? t('updating') : t('updateSubscription')}
                </Button>
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">{t('td_subscriptionHistory')}</CardTitle>
              </CardHeader>
              <CardContent>
                <AuditEntryList entries={subscriptionAudit} planNames={planNames} emptyLabel={t('td_subscriptionHistoryEmpty')} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/OrganizationDetail.tsx src/i18n.ts src/pages/super-admin/__tests__/OrganizationDetail.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/pages/super-admin/OrganizationDetail.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx
git commit -m "feat(web): rebuild Tenant Detail page skeleton — anchor rail, Summary + Subscription sections"
```

---

### Task 11: `OrganizationDetail.tsx` — Lifecycle timeline + Suspend/Archive/Reactivate wiring + Users section

**Files:**
- Modify: `web/src/pages/super-admin/OrganizationDetail.tsx` (the file Task 10 created)
- Modify: `web/src/i18n.ts` (add keys)
- Modify: `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx` (extend)

**Interfaces:**
- Consumes: `SuspendTenantDialog` (Task 7), `ArchiveSheet` (Task 8), existing `ConfirmActionDialog` (used unmodified, for Reactivate only), existing `GET /api/super-admin/users?tenant_id=` filter (already supported by `GetAllUsersSuper`, unused by any UI until now).
- Produces: section ids `lifecycle` and `users` added to the DOM and to `SECTIONS`. No new exports for later tasks.

- [ ] **Step 1: Extend the failing test**

In `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`, add a new top-level constant next to `mockAudit` (same module scope, before `function renderPage()`):

```tsx
const mockUsers = { users: [{ id: 'u1', email: 'staff@acme.test', role: 'admin', created_at: '2026-02-01T00:00:00Z' }], total: 1 };
```

Rename the `describe` title from `'OrganizationDetail — Summary + Subscription sections'` to `'OrganizationDetail'` (it now covers more than two sections), update the existing `beforeEach`'s `api.get` mock to also answer `/users` (add an `if (url.includes('/users')) return Promise.resolve({ data: mockUsers });` branch alongside the existing `/stats`/`/plans`/`/audit-log` branches), then add these two `it` blocks after the existing two:

```tsx
it('suspend action is only offered for an active tenant, and opens the checkbox-gated dialog', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^suspend$/i }));
  expect(screen.getByRole('checkbox')).toBeInTheDocument();
});

it('renders the Users section from the tenant-scoped users endpoint', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('staff@acme.test')).toBeInTheDocument());
});
```

Apply the noted `beforeEach` change for real (add the `/users` branch to the existing `api.get` mock implementation).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`
Expected: FAIL — no Suspend button exists yet with that exact accessible name, no Users section renders `staff@acme.test`.

- [ ] **Step 3: Add i18n keys**

`en.translation`, immediately after Task 10's `td_subscriptionHistoryEmpty` line:

```ts
          td_nav_lifecycle: "Lifecycle",
          td_nav_users: "Users",
          td_usersEmpty: "No users in this organization yet.",
```

`ru.translation`, same relative position:

```ts
          td_nav_lifecycle: "Жизненный цикл",
          td_nav_users: "Пользователи",
          td_usersEmpty: "В этой организации пока нет пользователей.",
```

- [ ] **Step 4: Modify the imports**

In `web/src/pages/super-admin/OrganizationDetail.tsx`, replace the import block (everything from `import { useEffect, useState }` through `import type { AuditLogEntry } from '@/lib/auditFormat';`) with:

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Users, Calendar, UserCheck } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { TenantIdentityHeader } from '@/components/TenantIdentityHeader';
import { AuditEntryList } from '@/components/AuditEntryList';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { SuspendTenantDialog } from '@/components/SuspendTenantDialog';
import { ArchiveSheet } from '@/components/ArchiveSheet';
import { useScrollSpy } from '@/hooks/useScrollSpy';
import { meterTone, meterToneClass } from '@/lib/meters';
import { resolvedLimit } from '@/lib/tenantQueues';
import type { AuditLogEntry } from '@/lib/auditFormat';

type TenantUser = { id: string; email: string; role: string; created_at: string };
```

- [ ] **Step 5: Extend `SECTIONS`**

Replace:

```tsx
const SECTIONS: Array<{ id: string; labelKey: string }> = [
  { id: 'summary', labelKey: 'td_nav_summary' },
  { id: 'subscription', labelKey: 'td_nav_subscription' },
];
```

with:

```tsx
const SECTIONS: Array<{ id: string; labelKey: string }> = [
  { id: 'summary', labelKey: 'td_nav_summary' },
  { id: 'subscription', labelKey: 'td_nav_subscription' },
  { id: 'lifecycle', labelKey: 'td_nav_lifecycle' },
  { id: 'users', labelKey: 'td_nav_users' },
];
```

- [ ] **Step 6: Add new state**

Replace the state block (from `const [tenant, setTenant]` through `const [subscriptionReason, setSubscriptionReason] = useState('');`) with the same lines plus these additions at the end:

```tsx
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [customLimits, setCustomLimits] = useState('{}');
  const [adminNotes, setAdminNotes] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [subscriptionReason, setSubscriptionReason] = useState('');

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
```

- [ ] **Step 7: Fetch users alongside the existing `Promise.all`**

Replace the `loadData` function's `Promise.all` call and its destructuring:

```tsx
      const [tenantResponse, plansResponse, auditResponse] = await Promise.all([
        api.get(`/api/super-admin/tenants/${id}/stats`),
        api.get('/api/super-admin/plans'),
        api.get(`/api/super-admin/audit-log?target_id=${id}&limit=100`),
      ]);

      setTenant(tenantResponse.data);
      setPlans(plansResponse.data);
      setAuditEntries(auditResponse.data.logs || []);
```

with:

```tsx
      const [tenantResponse, plansResponse, auditResponse, usersResponse] = await Promise.all([
        api.get(`/api/super-admin/tenants/${id}/stats`),
        api.get('/api/super-admin/plans'),
        api.get(`/api/super-admin/audit-log?target_id=${id}&limit=100`),
        api.get(`/api/super-admin/users?tenant_id=${id}`),
      ]);

      setTenant(tenantResponse.data);
      setPlans(plansResponse.data);
      setAuditEntries(auditResponse.data.logs || []);
      setUsers(usersResponse.data.users || []);
```

- [ ] **Step 8: Add the lifecycle action handlers**

Insert immediately after the `updateSubscription` function (before the `if (loading)` block):

```tsx
  const runSuspend = async (reason: string) => {
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/suspend`, { reason });
      toast.success(t('lifecycle_suspend_done'));
      setSuspendOpen(false);
      await loadData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runArchive = async (reason: string) => {
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/archive`, { reason });
      toast.success(t('lifecycle_archive_done'));
      setArchiveOpen(false);
      await loadData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runReactivate = async () => {
    setLifecycleBusy(true);
    try {
      await api.post(`/api/super-admin/tenants/${id}/reactivate`);
      toast.success(t('lifecycle_reactivate_done'));
      setReactivateOpen(false);
      await loadData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('lifecycleFailed'));
    } finally {
      setLifecycleBusy(false);
    }
  };
```

- [ ] **Step 9: Render the dialogs and the two new sections**

Replace:

```tsx
        <TenantIdentityHeader
          name={tenant.tenant?.name ?? ''}
          status={tenant.tenant?.status}
          planName={tenant.subscription?.plan?.name}
        />

        <div className="space-y-10">
```

with:

```tsx
        <TenantIdentityHeader
          name={tenant.tenant?.name ?? ''}
          status={tenant.tenant?.status}
          planName={tenant.subscription?.plan?.name}
        />

        <ConfirmActionDialog
          open={reactivateOpen}
          onOpenChange={setReactivateOpen}
          title={t('lifecycle_reactivate_title')}
          description={t('lifecycle_reactivate_description', { tenant: tenant.tenant?.name })}
          confirmLabel={t('lifecycle_reactivate_confirm')}
          onConfirm={runReactivate}
          busy={lifecycleBusy}
        />
        <SuspendTenantDialog
          open={suspendOpen}
          onOpenChange={setSuspendOpen}
          tenantName={tenant.tenant?.name ?? ''}
          usersCount={tenant.users_count ?? 0}
          eventsCount={tenant.events_count ?? 0}
          onConfirm={runSuspend}
          busy={lifecycleBusy}
        />
        <ArchiveSheet
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          tenantName={tenant.tenant?.name ?? ''}
          usersCount={tenant.users_count ?? 0}
          eventsCount={tenant.events_count ?? 0}
          onConfirm={runArchive}
          busy={lifecycleBusy}
        />

        <div className="space-y-10">
```

Then replace the subscription `</section>` closing (currently immediately followed by `</div>\n      </div>\n    </div>\n  );\n}`) with the same `</section>` plus the two new sections inserted before the closing wrapper divs:

```tsx
          </section>

          <section id="lifecycle">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_lifecycle')}</h2>
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center gap-2 text-sm">
                  {(['active', 'suspended', 'archived'] as const).map((s, i, arr) => (
                    <div key={s} className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 ${
                          (tenant.tenant?.status ?? 'active') === s
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {t(`tenantStatus_${s}`)}
                      </span>
                      {i < arr.length - 1 && <span className="text-muted-foreground">→</span>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  {tenant.tenant?.status === 'active' && (
                    <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                      {t('suspendTenant')}
                    </Button>
                  )}
                  {tenant.tenant?.status === 'suspended' && (
                    <>
                      <Button onClick={() => setReactivateOpen(true)}>{t('reactivateTenant')}</Button>
                      <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                        {t('archiveTenant')}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="users">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_users')}</h2>
            <Card>
              <CardContent className="pt-6">
                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('td_usersEmpty')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('email')}</TableHead>
                        <TableHead>{t('role')}</TableHead>
                        <TableHead>{t('created')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>{u.email}</TableCell>
                          <TableCell className="capitalize">{u.role}</TableCell>
                          <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 11: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/OrganizationDetail.tsx src/i18n.ts src/pages/super-admin/__tests__/OrganizationDetail.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/pages/super-admin/OrganizationDetail.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx
git commit -m "feat(web): wire Lifecycle timeline (Suspend/Archive/Reactivate) and Users section"
```

---

### Task 12: `OrganizationDetail.tsx` — Activity section, impersonation ceremony wiring, final assembly

**Files:**
- Modify: `web/src/pages/super-admin/OrganizationDetail.tsx` (the file Tasks 10-11 built)
- Modify: `web/src/i18n.ts` (add keys)
- Modify: `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx` (extend)

**Interfaces:**
- Consumes: `ImpersonateDialog` (Task 9), `startImpersonation` (existing `web/src/lib/impersonation.ts`, its signature already tolerates this call site unchanged per Task 9's `Omit<ImpersonationSession, 'mintedAt'>` design), `AuditEntryList` (Task 5) reused a second time over the full unfiltered `auditEntries` state already fetched in Task 10.
- Produces: the complete, final Tenant Detail page — all five sections (`summary`, `subscription`, `lifecycle`, `users`, `activity`) live in `SECTIONS` and in the DOM. Nothing further consumes this file within Batch 2.

- [ ] **Step 1: Extend the failing test**

Add to `web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`, after the two `it` blocks added in Task 11:

```tsx
it('renders the Activity section with the full tenant-scoped audit feed', async () => {
  const auditWithEntries = {
    logs: [
      {
        id: 'a1',
        admin_user_id: 'op1',
        action: 'suspend_tenant',
        target_type: 'tenant',
        target_id: 't1',
        changes: { from: 'active', to: 'suspended' },
        ip_address: null,
        user_agent: null,
        created_at: '2026-07-10T10:00:00Z',
      },
    ],
  };
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/stats')) return Promise.resolve({ data: mockStats });
    if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
    if (url.includes('/audit-log')) return Promise.resolve({ data: auditWithEntries });
    if (url.includes('/users')) return Promise.resolve({ data: mockUsers });
    return Promise.reject(new Error('unexpected url ' + url));
  });
  renderPage();
  await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
});

it('opens the mandatory-reason impersonate dialog', async () => {
  renderPage();
  await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /impersonate/i }));
  expect(screen.getByRole('button', { name: /start session/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`
Expected: FAIL — no Activity section renders the audit feed, no Impersonate button/dialog exists yet.

- [ ] **Step 3: Add i18n keys**

`en.translation`, immediately after Task 11's `td_usersEmpty` line:

```ts
          td_nav_activity: "Activity",
          td_activityEmpty: "No activity recorded for this organization yet.",
```

`ru.translation`, same relative position:

```ts
          td_nav_activity: "Активность",
          td_activityEmpty: "Для этой организации пока не зафиксировано активности.",
```

- [ ] **Step 4: Add the impersonation import, state, and handler**

Add to the import block (alongside the other `@/components/...`/`@/lib/...` imports added in Task 11):

```tsx
import { ImpersonateDialog } from '@/components/ImpersonateDialog';
import { startImpersonation } from '@/lib/impersonation';
```

Add to the state block, after `const [lifecycleBusy, setLifecycleBusy] = useState(false);`:

```tsx
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
```

Add the handler after `runReactivate` (before the `if (loading)` block):

```tsx
  const impersonate = async (reason: string) => {
    setImpersonating(true);
    try {
      const { data } = await api.post(`/api/super-admin/tenants/${id}/impersonate`, { reason });
      startImpersonation(data.token, {
        tenantId: data.tenant_id,
        tenantName: tenant?.tenant?.name || id || '',
        expiresAt: data.expires_at,
      });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('impersonateFailed'));
      setImpersonating(false);
      setImpersonateOpen(false);
    }
  };
```

- [ ] **Step 5: Add the Impersonate button and dialog, and update `SECTIONS`**

Replace:

```tsx
const SECTIONS: Array<{ id: string; labelKey: string }> = [
  { id: 'summary', labelKey: 'td_nav_summary' },
  { id: 'subscription', labelKey: 'td_nav_subscription' },
  { id: 'lifecycle', labelKey: 'td_nav_lifecycle' },
  { id: 'users', labelKey: 'td_nav_users' },
];
```

with:

```tsx
const SECTIONS: Array<{ id: string; labelKey: string }> = [
  { id: 'summary', labelKey: 'td_nav_summary' },
  { id: 'subscription', labelKey: 'td_nav_subscription' },
  { id: 'lifecycle', labelKey: 'td_nav_lifecycle' },
  { id: 'users', labelKey: 'td_nav_users' },
  { id: 'activity', labelKey: 'td_nav_activity' },
];
```

Replace the back-button row:

```tsx
        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/super-admin/organizations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
```

with:

```tsx
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/super-admin/organizations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Button variant="outline" onClick={() => setImpersonateOpen(true)}>
            {t('impersonate')}
          </Button>
        </div>
```

Add the dialog alongside the other three dialogs (after the `ArchiveSheet` block, still before `<div className="space-y-10">`):

```tsx
        <ImpersonateDialog
          open={impersonateOpen}
          onOpenChange={setImpersonateOpen}
          tenantName={tenant.tenant?.name ?? ''}
          onConfirm={impersonate}
          busy={impersonating}
        />
```

- [ ] **Step 6: Add the Activity section**

Replace the Users section's closing (currently `</section>\n        </div>\n      </div>\n    </div>\n  );\n}`) with the Users section's closing plus the new Activity section before the wrapper divs:

```tsx
          </section>

          <section id="activity">
            <h2 className="mb-4 text-lg font-semibold">{t('td_nav_activity')}</h2>
            <Card>
              <CardContent className="pt-6">
                <AuditEntryList entries={auditEntries} planNames={planNames} emptyLabel={t('td_activityEmpty')} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/OrganizationDetail.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 8: Full frontend gate**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/OrganizationDetail.tsx src/i18n.ts src/pages/super-admin/__tests__/OrganizationDetail.test.tsx && npx vitest run`
Expected: all pass (full suite, not just this file — confirms Tasks 1-11's tests still pass after this file's final edit).

- [ ] **Step 9: Live-browser click-through**

Per this session's established verification pattern (see `docs/superpowers/plans/2026-07-11-console-redesign-batch1.md`'s own end-of-batch step), before committing this final task, manually verify in a running dev server (`cd web && npm run dev`, backend + Postgres up per `docker-compose.yml`):

1. Navigate to `/super-admin/organizations/:id` for a real seeded tenant. Confirm the anchor rail highlights `Summary` on load and updates as you scroll through all five sections.
2. Save a subscription change with the reason field empty — confirm the button stays disabled; fill it in — confirm it saves and the change appears in both the Subscription tab's change feed and the Activity tab.
3. Suspend a tenant: confirm the checkbox gate, typed-confirm gate, and that both must be satisfied before the button enables; confirm the lifecycle timeline updates after success.
4. Archive a suspended tenant: confirm both checkboxes gate the Sheet's confirm button independently.
5. Reactivate: confirm the plain `ConfirmActionDialog` flow is unchanged.
6. Impersonate: confirm the reason field gates the Start button; confirm the amber banner appears; click Exit — confirm the summary dialog shows a real duration/action count (make at least one change while impersonating first) — confirm "View activity log" lands back on this tenant's Activity section with the hash-anchor scroll working.
7. Repeat steps 1-2 in dark mode and with the language toggle set to RU, confirming no untranslated key strings (`td_...`) are visible anywhere.

Flag any deviation found back to the user before merging — do not silently fix product-shape issues found here; this step verifies the plan's assumptions against the real running app the way Batch 1's did.

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/super-admin/OrganizationDetail.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/OrganizationDetail.test.tsx
git commit -m "feat(web): wire Activity section and impersonation ceremony — Tenant Detail workbench complete"
```

---

## End of Batch 2

After Task 12, the Tenant Detail workbench is feature-complete per the design spec: persistent identity header, five stacked sections behind a sticky anchor rail, lifecycle state timeline with checkbox-gated Suspend modal / Archive side-sheet, and a ceremonial impersonation entry (mandatory reason) + exit (duration/action-count summary). `ConfirmActionDialog` was never modified — only composed via the new `useTypedConfirmGate` hook and reused as-is for Reactivate.

**Known, documented-not-fixed gaps** (per spec's Out of Scope — flag to the user before merging, do not silently address):
- No "last login" column on the Users tab (no backend field exists).
- Suspend/Archive live-consequence copy shows aggregate counts only, not the literal "event X is running today" example from the design brief (no such query exists).
- Users tab has no its own pagination — `GetAllUsersSuper` already supports `page`/`page_size`, unused here since a single tenant's user count is expected to stay small; revisit if a tenant with hundreds of users surfaces in practice.

**Batch 3 (separate plan, written after Batch 2 ships)** covers: Audit Log page reskin (day-grouping, action badges, human-readable diffs — reusing this batch's `AuditEntryList` component unmodified) and the Plans editor reskin (explicit limit/feature fields per design brief item 5), per `docs/superpowers/specs/2026-07-11-console-redesign-batch2-design.md`'s scope decomposition.
