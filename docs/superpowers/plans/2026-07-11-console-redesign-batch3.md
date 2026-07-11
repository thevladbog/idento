# Platform Console Redesign — Batch 3 (Audit Log + Plans Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `AuditLog.tsx` table with a filterable (actor/action/tenant/date), paginated, human-readable-diff view built on Batch 2's `AuditEntryList`, and add an explicit "Unlimited" toggle to the Plans editor's limit fields, per `docs/superpowers/specs/2026-07-11-console-redesign-batch3-design.md`.

**Architecture:** Three small backend additions (an `admin_user_id` filter and a `date_from`/`date_to` filter on `GetAuditLog`, both following the exact combinable/tolerant-of-invalid-input pattern the `target_id` filter already established in Batch 2; an old/new diff captured on plan updates, mirroring `UpdateTenantSubscription`'s existing shape) unlock a frontend rebuild that reuses Batch 2's `AuditEntryList` unmodified. A new `TenantCombobox` component (Popover + the already-installed, currently-unused `Command` primitive) is the only new UI primitive. `SubscriptionPlans.tsx`'s Unlimited toggle is a self-contained, independent addition to the existing form.

**Tech Stack:** Go 1.x / Echo v4 / pgx v5 (backend, Tasks 1–3); React 18.3.1 + Vite + TypeScript + Tailwind v4 + shadcn/radix primitives (`Popover`, `Command` — both already installed, neither used yet) + react-i18next + vitest/@testing-library/react (frontend, Tasks 4–7). No new npm/Go dependencies.

## Global Constraints

- **Filter tolerance convention:** every new `GetAuditLog` filter (`admin_user_id`, `date_from`, `date_to`) is optional, combinable with the existing `action`/`target_id` filters (ANDed), and silently ignored when absent or malformed — never a `400`. This matches the existing `action`/`target_id` filters exactly (Batch 2, Task 1).
- **`date_from`/`date_to` are UTC-day boundaries.** Native `<input type="date">` values are timezone-naive `YYYY-MM-DD` strings; the backend treats `date_from` as `>= YYYY-MM-DD 00:00:00 UTC` and `date_to` as `< (YYYY-MM-DD + 1 day) 00:00:00 UTC` (i.e. inclusive of the whole `date_to` day). This is a documented, accepted characteristic (see spec's Risks section), not a bug to fix.
- **`AuditEntryList` (`web/src/components/AuditEntryList.tsx`) is NOT modified.** It is reused a third time (after Batch 2's Subscription-history and Activity-tab call sites) with its existing `{ entries, planNames?, emptyLabel }` props, unchanged.
- **Plans editor keeps its current fixed 3-limits (`events_per_month`, `attendees_per_event`, `users`) / 3-features (`custom_branding`, `api_access`, `priority_support`) shape.** No dynamic/arbitrary-key field support — only the Unlimited toggle is added.
- **No new date-picker component.** Two plain `<input type="date">` fields, per the spec's explicit decision.
- **Actor filter is a fixed dropdown**, populated from `GET /api/super-admin/users?page_size=100` filtered client-side to `is_super_admin === true` — no new backend endpoint, no search-as-you-type.
- **Tenant filter (`TenantCombobox`) is populated from the existing unpaginated `GET /api/super-admin/tenants`** (the same fetch `Organizations.tsx` already does), filtered/searched client-side — no new backend endpoint.
- **Audit Log gets real server-side pagination** (Previous/Next wired to the response's `total`/`offset`/`limit`), reusing the existing `previousPage`/`nextPage`/`paginationOf` i18n keys (already used by `Organizations.tsx`'s client-side pagination) — this is the one console surface designed for genuinely unbounded growth.
- **i18n convention:** flat camelCase keys added to both `en.translation` and `ru.translation` blocks in `web/src/i18n.ts`, at the same relative position in each. New prefix for this batch: `auditLog_<field>` for the new filter widgets' copy (distinct from the existing bare `auditLog`/`allActions`/etc. keys, which are reused unchanged).
- **Backend gate:** every backend task ends with `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...` passing.
- **Frontend gate:** every frontend task ends with `cd web && npx tsc -b --noEmit && npx eslint <touched files> && npx vitest run` passing.

---

### Task 1: Backend — `admin_user_id` filter on `GetAuditLog`

**Files:**
- Modify: `backend/internal/store/pg_store.go:1613-1671` (`GetAuditLog`)
- Modify: `backend/internal/handler/super_admin.go:324-358` (`GetAuditLog` handler)
- Test: `backend/internal/handler/super_admin_test.go` (append)

**Interfaces:**
- Consumes: existing `store.Store.GetAuditLog(ctx, filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error)` — signature unchanged, only the SQL builder and the handler's filter-population change.
- Produces: `GET /api/super-admin/audit-log` now accepts an optional `?admin_user_id=<uuid>` query param, combinable with `?action=` and `?target_id=`. Invalid/absent `admin_user_id` is silently ignored (same tolerance as the existing filters), never a `400`.

- [ ] **Step 1: Write the failing handler test**

Append to `backend/internal/handler/super_admin_test.go`:

```go
func TestGetAuditLog_AdminUserIDFilterPassedToStore(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	adminID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?admin_user_id="+adminID.String(), nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedFilters["admin_user_id"] != adminID {
		t.Fatalf("expected admin_user_id filter %v, got %#v", adminID, capturedFilters["admin_user_id"])
	}
}

func TestGetAuditLog_InvalidAdminUserIDIgnoredNot400(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?admin_user_id=not-a-uuid", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (invalid admin_user_id must be ignored, not rejected), got %d", rec.Code)
	}
	if _, ok := capturedFilters["admin_user_id"]; ok {
		t.Fatalf("expected no admin_user_id key when param is invalid, got %#v", capturedFilters)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/... -run TestGetAuditLog_AdminUserID -v`
Expected: FAIL — the handler doesn't read `admin_user_id` yet.

- [ ] **Step 3: Add the query param to the handler**

In `backend/internal/handler/super_admin.go`, inside `GetAuditLog`, add after the existing `target_id` block:

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
	if adminUserIDStr := c.QueryParam("admin_user_id"); adminUserIDStr != "" {
		if adminUserID, err := uuid.Parse(adminUserIDStr); err == nil {
			filters["admin_user_id"] = adminUserID
		}
	}
```

- [ ] **Step 4: Add the SQL condition in the store**

In `backend/internal/store/pg_store.go`, inside `GetAuditLog`, add after the existing `target_id` condition:

```go
	if action, ok := filters["action"].(string); ok && action != "" {
		args = append(args, action)
		conditions = append(conditions, fmt.Sprintf("action = $%d", len(args)))
	}
	if targetID, ok := filters["target_id"].(uuid.UUID); ok {
		args = append(args, targetID)
		conditions = append(conditions, fmt.Sprintf("target_id = $%d", len(args)))
	}
	if adminUserID, ok := filters["admin_user_id"].(uuid.UUID); ok {
		args = append(args, adminUserID)
		conditions = append(conditions, fmt.Sprintf("admin_user_id = $%d", len(args)))
	}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/... -run TestGetAuditLog_AdminUserID -v`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full backend gate and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...`
Expected: all pass.

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go backend/internal/store/pg_store.go
git commit -m "feat(backend): add admin_user_id filter to GetAuditLog"
```

---

### Task 2: Backend — `date_from`/`date_to` filter on `GetAuditLog`

**Files:**
- Modify: `backend/internal/store/pg_store.go` (`GetAuditLog`, the same conditions block Task 1 just extended)
- Modify: `backend/internal/handler/super_admin.go` (`GetAuditLog` handler, same filter-population block)
- Test: `backend/internal/handler/super_admin_test.go` (append)

**Interfaces:**
- Consumes: nothing new — same `filters map[string]interface{}` contract.
- Produces: `GET /api/super-admin/audit-log` now accepts optional `?date_from=YYYY-MM-DD` and `?date_to=YYYY-MM-DD`, combinable with all other filters. `date_from` matches `created_at >= <date_from> 00:00:00 UTC`; `date_to` matches `created_at < (<date_to> + 1 day) 00:00:00 UTC` (inclusive of the whole `date_to` day). Malformed dates are silently ignored, never a `400`.

- [ ] **Step 1: Write the failing handler test**

Append to `backend/internal/handler/super_admin_test.go`:

```go
func TestGetAuditLog_DateRangeFilterPassedToStore(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?date_from=2026-07-01&date_to=2026-07-11", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	dateFrom, ok := capturedFilters["date_from"].(time.Time)
	if !ok || !dateFrom.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("expected date_from 2026-07-01 UTC, got %#v", capturedFilters["date_from"])
	}
	dateTo, ok := capturedFilters["date_to"].(time.Time)
	if !ok || !dateTo.Equal(time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("expected date_to 2026-07-11 UTC, got %#v", capturedFilters["date_to"])
	}
}

func TestGetAuditLog_MalformedDatesIgnoredNot400(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?date_from=not-a-date&date_to=07/11/2026", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (malformed dates must be ignored, not rejected), got %d", rec.Code)
	}
	if _, ok := capturedFilters["date_from"]; ok {
		t.Fatalf("expected no date_from key when param is malformed, got %#v", capturedFilters)
	}
	if _, ok := capturedFilters["date_to"]; ok {
		t.Fatalf("expected no date_to key when param is malformed, got %#v", capturedFilters)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/... -run TestGetAuditLog_DateRange -v && go test ./internal/handler/... -run TestGetAuditLog_MalformedDates -v`
Expected: FAIL — the handler doesn't read `date_from`/`date_to` yet.

- [ ] **Step 3: Add the query params to the handler**

In `backend/internal/handler/super_admin.go`, inside `GetAuditLog`, add after the `admin_user_id` block from Task 1:

```go
	if dateFromStr := c.QueryParam("date_from"); dateFromStr != "" {
		if dateFrom, err := time.Parse("2006-01-02", dateFromStr); err == nil {
			filters["date_from"] = dateFrom
		}
	}
	if dateToStr := c.QueryParam("date_to"); dateToStr != "" {
		if dateTo, err := time.Parse("2006-01-02", dateToStr); err == nil {
			filters["date_to"] = dateTo
		}
	}
```

(`time` is already imported in this file.)

- [ ] **Step 4: Add the SQL conditions in the store**

In `backend/internal/store/pg_store.go`, inside `GetAuditLog`, add after the `admin_user_id` condition from Task 1:

```go
	if adminUserID, ok := filters["admin_user_id"].(uuid.UUID); ok {
		args = append(args, adminUserID)
		conditions = append(conditions, fmt.Sprintf("admin_user_id = $%d", len(args)))
	}
	if dateFrom, ok := filters["date_from"].(time.Time); ok {
		args = append(args, dateFrom)
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", len(args)))
	}
	if dateTo, ok := filters["date_to"].(time.Time); ok {
		args = append(args, dateTo.Add(24*time.Hour))
		conditions = append(conditions, fmt.Sprintf("created_at < $%d", len(args)))
	}
```

Confirm `"time"` is already imported in `pg_store.go` first (`grep -n '"time"' backend/internal/store/pg_store.go` — it's a large file already using `time.Time` extensively elsewhere, so this should already be present; add it if not).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/... -run TestGetAuditLog_DateRange -v && go test ./internal/handler/... -run TestGetAuditLog_MalformedDates -v`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full backend gate and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...`
Expected: all pass.

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go backend/internal/store/pg_store.go
git commit -m "feat(backend): add date_from/date_to filter to GetAuditLog"
```

---

### Task 3: Backend — capture old/new diff on subscription plan updates

**Files:**
- Modify: `backend/internal/handler/super_admin.go:238-267` (`UpdateSubscriptionPlanSuper`)
- Modify: `backend/internal/handler/testsupport_test.go` (add `getSubscriptionPlanByID`/`updateSubscriptionPlan` fakeStore fields + wrapper methods)
- Test: `backend/internal/handler/super_admin_test.go` (append)

**Interfaces:**
- Consumes: existing `Store.GetSubscriptionPlanByID(ctx, id uuid.UUID) (*models.SubscriptionPlan, error)` (`backend/internal/store/pg_store.go:1245`, already implemented, not yet wrapped in `fakeStore` — this task adds that wrapper) and existing `Store.UpdateSubscriptionPlan(ctx, plan *models.SubscriptionPlan) error`.
- Produces: `PUT /tenants/:id/subscription`... no — `PUT /super-admin/plans/:id` now logs `changes: {"old": <plan before update>, "new": <plan after update>}` instead of `changes: {"plan": <new state>}`. Response body/status codes for the happy path are unchanged. `CreateSubscriptionPlan`'s logging (`{"plan": plan}`) is untouched — there's no "old" state for a creation event.

- [ ] **Step 1: Add fakeStore wrapper fields and methods**

In `backend/internal/handler/testsupport_test.go`, add two fields to the `fakeStore` struct, near the existing `getSubscriptionByTenantID`/`updateSubscription` fields:

```go
	getSubscriptionPlanByID func(id uuid.UUID) (*models.SubscriptionPlan, error)
	updateSubscriptionPlan  func(plan *models.SubscriptionPlan) error
```

Add the wrapper methods near the existing `GetSubscriptionByTenantID`/`UpdateSubscription` wrappers:

```go
func (f *fakeStore) GetSubscriptionPlanByID(_ context.Context, id uuid.UUID) (*models.SubscriptionPlan, error) {
	return f.getSubscriptionPlanByID(id)
}
func (f *fakeStore) UpdateSubscriptionPlan(_ context.Context, plan *models.SubscriptionPlan) error {
	return f.updateSubscriptionPlan(plan)
}
```

- [ ] **Step 2: Write the failing test**

Append to `backend/internal/handler/super_admin_test.go`:

```go
func TestUpdateSubscriptionPlanSuper_LogsOldAndNew(t *testing.T) {
	e := echo.New()
	planID := uuid.New()
	adminID := uuid.New()
	oldPlan := &models.SubscriptionPlan{ID: planID, Name: "Starter", PriceMonthly: 29}
	var capturedChanges map[string]interface{}

	fs := &fakeStore{
		getSubscriptionPlanByID: func(id uuid.UUID) (*models.SubscriptionPlan, error) {
			if id == planID {
				return oldPlan, nil
			}
			return nil, fmt.Errorf("not found")
		},
		updateSubscriptionPlan: func(plan *models.SubscriptionPlan) error { return nil },
		logAdminAction: func(_ uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, _, _ string) error {
			if action == "update_plan" {
				capturedChanges = changes.(map[string]interface{})
			}
			return nil
		},
	}
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]interface{}{"name": "Professional", "price_monthly": 99})
	req := httptest.NewRequest(http.MethodPut, "/api/super-admin/plans/"+planID.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(planID.String())
	c.Set("user", &models.JWTCustomClaims{UserID: adminID.String(), TenantID: uuid.New().String(), Role: "admin"})

	if err := h.UpdateSubscriptionPlanSuper(c); err != nil {
		t.Fatalf("UpdateSubscriptionPlanSuper returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedChanges == nil {
		t.Fatalf("expected update_plan changes to be captured, got nil")
	}
	old, ok := capturedChanges["old"].(*models.SubscriptionPlan)
	if !ok || old.Name != "Starter" {
		t.Fatalf("expected old plan with Name=Starter, got %#v", capturedChanges["old"])
	}
	newP, ok := capturedChanges["new"].(models.SubscriptionPlan)
	if !ok || newP.Name != "Professional" {
		t.Fatalf("expected new plan with Name=Professional, got %#v", capturedChanges["new"])
	}
}
```

(`fmt` must be imported in `super_admin_test.go` for the `fmt.Errorf` in the fake — check first with `grep -n '"fmt"' backend/internal/handler/super_admin_test.go`; add it to the import block if missing.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && go test ./internal/handler/... -run TestUpdateSubscriptionPlanSuper_LogsOldAndNew -v`
Expected: FAIL — build error (`fakeStore` has no `getSubscriptionPlanByID`/`updateSubscriptionPlan` fields yet, if Step 1 wasn't applied) or the captured `changes["old"]` assertion fails (still logging the old `{"plan": plan}` shape).

- [ ] **Step 4: Implement**

Replace `UpdateSubscriptionPlanSuper` in `backend/internal/handler/super_admin.go`:

```go
// UpdateSubscriptionPlanSuper updates a subscription plan
func (h *Handler) UpdateSubscriptionPlanSuper(c echo.Context) error {
	planID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid plan ID",
		})
	}

	var plan models.SubscriptionPlan
	if err := c.Bind(&plan); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	plan.ID = planID

	oldPlan, err := h.Store.GetSubscriptionPlanByID(c.Request().Context(), planID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load plan",
		})
	}

	if err := h.Store.UpdateSubscriptionPlan(c.Request().Context(), &plan); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update plan",
		})
	}

	// Log admin action
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "update_plan", "subscription_plan", plan.ID, map[string]interface{}{
		"old": oldPlan,
		"new": plan,
	}, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}

	return c.JSON(http.StatusOK, plan)
}
```

Leave `CreateSubscriptionPlan` untouched.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/handler/... -run TestUpdateSubscriptionPlanSuper_LogsOldAndNew -v`
Expected: PASS, 1 test.

- [ ] **Step 6: Full backend gate and commit**

Run: `cd backend && go build ./... && go vet ./... && go test ./internal/handler/... ./internal/store/...`
Expected: all pass. Also grep-verify no other code reads audit rows assuming `changes["plan"]` for `action="update_plan"` before committing: `grep -rn 'update_plan' backend/internal web --include="*.go" --include="*.ts" --include="*.tsx"` should show only the handler you just changed and (after Task 4) the new `formatAuditDiff` case — nothing else depends on the old `{"plan": ...}` shape for updates.

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_test.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): log old/new diff on subscription plan updates"
```

---

### Task 4: Frontend — extend `formatAuditDiff` for `create_plan`/`update_plan`

**Files:**
- Modify: `web/src/lib/auditFormat.ts` (`formatAuditDiff`)
- Test: `web/src/lib/__tests__/auditFormat.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `formatAuditDiff` now renders `create_plan`/`update_plan` entries as human-readable lines instead of falling through to the generic `entry.action.replace(/_/g, ' ')` default. `AuditEntryList` (which calls this function) needs no changes. Consumed by Task 6 (Audit Log page) — Batch 2's Subscription-history/Activity call sites never render these actions (they're not tenant-targeted), so this is purely additive with zero behavior change for existing callers.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/__tests__/auditFormat.test.ts` (inside the existing `describe('formatAuditDiff', ...)` block, after its last `it`):

```ts
  it('renders plan creation', () => {
    const line = formatAuditDiff(entry({ action: 'create_plan', changes: { plan: { name: 'Professional' } } }));
    expect(line).toBe('Plan created: Professional');
  });

  it('renders plan updates as a field-level diff', () => {
    const line = formatAuditDiff(
      entry({
        action: 'update_plan',
        changes: {
          old: { name: 'Starter', price_monthly: 29, is_active: true },
          new: { name: 'Professional', price_monthly: 99, is_active: true },
        },
      })
    );
    expect(line).toBe('Name: Starter → Professional; Price/mo: 29 → 99');
  });

  it('falls back to a generic label when nothing tracked in a plan update changed', () => {
    const line = formatAuditDiff(
      entry({ action: 'update_plan', changes: { old: { name: 'Starter' }, new: { name: 'Starter' } } })
    );
    expect(line).toBe('Plan updated');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/__tests__/auditFormat.test.ts`
Expected: FAIL — the three new assertions get the generic `'create plan'`/`'update plan'` fallback instead.

- [ ] **Step 3: Implement**

In `web/src/lib/auditFormat.ts`, insert two new `case`s into `formatAuditDiff`'s `switch`, immediately before the existing `case 'create_tenant':`:

```ts
    case 'create_plan': {
      const plan = (c.plan ?? {}) as Record<string, unknown>;
      return `Plan created: ${typeof plan.name === 'string' ? plan.name : '?'}${reasonSuffix}`;
    }
    case 'update_plan': {
      const oldPlan = (c.old ?? {}) as Record<string, unknown>;
      const newPlan = (c.new ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (oldPlan.name !== newPlan.name) {
        parts.push(`Name: ${oldPlan.name ?? '?'} → ${newPlan.name ?? '?'}`);
      }
      if (oldPlan.price_monthly !== newPlan.price_monthly) {
        parts.push(`Price/mo: ${oldPlan.price_monthly ?? '?'} → ${newPlan.price_monthly ?? '?'}`);
      }
      if (oldPlan.price_yearly !== newPlan.price_yearly) {
        parts.push(`Price/yr: ${oldPlan.price_yearly ?? '?'} → ${newPlan.price_yearly ?? '?'}`);
      }
      if (oldPlan.is_active !== newPlan.is_active) {
        parts.push(`Active: ${oldPlan.is_active ? 'yes' : 'no'} → ${newPlan.is_active ? 'yes' : 'no'}`);
      }
      if (oldPlan.is_public !== newPlan.is_public) {
        parts.push(`Public: ${oldPlan.is_public ? 'yes' : 'no'} → ${newPlan.is_public ? 'yes' : 'no'}`);
      }
      if (JSON.stringify(oldPlan.limits ?? {}) !== JSON.stringify(newPlan.limits ?? {})) {
        parts.push('Limits updated');
      }
      if (JSON.stringify(oldPlan.features ?? {}) !== JSON.stringify(newPlan.features ?? {})) {
        parts.push('Features updated');
      }
      if (parts.length === 0) parts.push('Plan updated');
      return parts.join('; ') + reasonSuffix;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/__tests__/auditFormat.test.ts`
Expected: PASS, 11 tests (8 pre-existing + 3 new).

- [ ] **Step 5: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/lib/auditFormat.ts src/lib/__tests__/auditFormat.test.ts && npx vitest run`
Expected: all pass.

```bash
git add web/src/lib/auditFormat.ts web/src/lib/__tests__/auditFormat.test.ts
git commit -m "feat(web): render human-readable diffs for create_plan/update_plan audit entries"
```

---

### Task 5: Frontend — `TenantCombobox` component

**Files:**
- Create: `web/src/components/TenantCombobox.tsx`
- Modify: `web/src/i18n.ts` (add keys — see Step 3)
- Test: `web/src/components/__tests__/TenantCombobox.test.tsx`

**Interfaces:**
- Consumes: existing `Popover`/`PopoverTrigger`/`PopoverContent` (`web/src/components/ui/popover.tsx`), existing `Command`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem` (`web/src/components/ui/command.tsx`, unused until now), existing `Button`, existing `cn` (`web/src/lib/utils.ts`).
- Produces: `<TenantCombobox tenants={{id: string, name: string}[]} value={string} onChange={(id: string) => void} />` — `value=''` means "all tenants" (no filter). Consumed by Task 6 (Audit Log page's tenant filter). A pure, self-contained, controlled component — no fetching of its own, no internal filter state beyond the popover's open/closed and the `Command`'s own built-in search-as-you-type (client-side, over the `tenants` prop).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/TenantCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TenantCombobox } from '../TenantCombobox';
import '../../i18n';

const tenants = [
  { id: 't1', name: 'Acme Corp' },
  { id: 't2', name: 'Second Tenant' },
];

describe('TenantCombobox', () => {
  it('shows "All tenants" when value is empty', () => {
    render(<TenantCombobox tenants={tenants} value="" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent(/all tenants/i);
  });

  it('shows the selected tenant name when value is set', () => {
    render(<TenantCombobox tenants={tenants} value="t2" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Second Tenant');
  });

  it('calls onChange with the selected tenant id when an item is picked', () => {
    const onChange = vi.fn();
    render(<TenantCombobox tenants={tenants} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Second Tenant'));
    expect(onChange).toHaveBeenCalledWith('t2');
  });

  it('calls onChange with an empty string when "All tenants" is picked', () => {
    const onChange = vi.fn();
    render(<TenantCombobox tenants={tenants} value="t1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getAllByText(/all tenants/i)[1]); // [0] is the trigger button itself
    expect(onChange).toHaveBeenCalledWith('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/TenantCombobox.test.tsx`
Expected: FAIL — `Cannot find module '../TenantCombobox'`.

- [ ] **Step 3: Add i18n keys**

`en.translation`, immediately after `td_activityEmpty` (Batch 2's last key):

```ts
          auditLog_actorLabel: "Actor",
          auditLog_allAdmins: "All admins",
          auditLog_tenantLabel: "Tenant",
          auditLog_allTenants: "All tenants",
          auditLog_tenantSearchPlaceholder: "Search tenants by name…",
          auditLog_noTenantsFound: "No tenants found",
          auditLog_dateFromLabel: "From",
          auditLog_dateToLabel: "To",
```

`ru.translation`, same relative position:

```ts
          auditLog_actorLabel: "Автор",
          auditLog_allAdmins: "Все администраторы",
          auditLog_tenantLabel: "Организация",
          auditLog_allTenants: "Все организации",
          auditLog_tenantSearchPlaceholder: "Поиск организаций по названию…",
          auditLog_noTenantsFound: "Организации не найдены",
          auditLog_dateFromLabel: "С",
          auditLog_dateToLabel: "По",
```

(This task only consumes `auditLog_allTenants`/`auditLog_tenantSearchPlaceholder`/`auditLog_noTenantsFound`; the rest are added now since they land at the same anchor and Task 6 needs them immediately after — avoids two separate edits to the same insertion point.)

- [ ] **Step 4: Implement the component**

Create `web/src/components/TenantCombobox.tsx`:

```tsx
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

export type TenantOption = { id: string; name: string };

type Props = {
  tenants: TenantOption[];
  value: string;
  onChange: (id: string) => void;
};

export function TenantCombobox({ tenants, value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = tenants.find((tn) => tn.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-[220px] justify-between">
          {selected ? selected.name : t('auditLog_allTenants')}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder={t('auditLog_tenantSearchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('auditLog_noTenantsFound')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === '' ? 'opacity-100' : 'opacity-0')} />
                {t('auditLog_allTenants')}
              </CommandItem>
              {tenants.map((tn) => (
                <CommandItem
                  key={tn.id}
                  value={tn.name}
                  onSelect={() => {
                    onChange(tn.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === tn.id ? 'opacity-100' : 'opacity-0')} />
                  {tn.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/__tests__/TenantCombobox.test.tsx`
Expected: PASS, 4 tests. (Radix `Popover`/`cmdk` render their content in a portal but into the same DOM document jsdom exposes to Testing Library, so `screen` queries work without extra setup — this already works for `Dialog`/`Sheet`-based components elsewhere in this codebase.)

- [ ] **Step 6: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/components/TenantCombobox.tsx src/i18n.ts src/components/__tests__/TenantCombobox.test.tsx && npx vitest run`
Expected: all pass.

```bash
git add web/src/components/TenantCombobox.tsx web/src/i18n.ts web/src/components/__tests__/TenantCombobox.test.tsx
git commit -m "feat(web): add TenantCombobox (Popover + Command tenant picker)"
```

---

### Task 6: Frontend — `AuditLog.tsx` rebuild (filters, `AuditEntryList`, pagination)

**Files:**
- Modify (full rewrite): `web/src/pages/super-admin/AuditLog.tsx`
- Test: `web/src/pages/super-admin/__tests__/AuditLog.test.tsx` (new — no test exists for this page today)

**Interfaces:**
- Consumes: `AuditEntryList` + `AuditLogEntry` type (Task 5's sibling, Batch 2's `web/src/components/AuditEntryList.tsx`, unmodified), `TenantCombobox` (Task 5), the new `admin_user_id`/`date_from`/`date_to` filters (Tasks 1-2) and the `create_plan`/`update_plan` diff rendering (Task 4) — all consumed transparently through `AuditEntryList`/`formatAuditDiff`, no direct imports of the diff logic needed here.
- Produces: the final Audit Log page. Nothing further in this plan consumes it.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/super-admin/__tests__/AuditLog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AuditLog from '../AuditLog';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));

const mockLogs = {
  total: 1,
  limit: 50,
  offset: 0,
  logs: [
    {
      id: 'a1',
      admin_user_id: 'admin-1',
      action: 'suspend_tenant',
      target_type: 'tenant',
      target_id: 't1',
      changes: { from: 'active', to: 'suspended' },
      ip_address: null,
      user_agent: null,
      created_at: '2026-07-11T10:00:00Z',
    },
  ],
};
const mockAdmins = { users: [{ id: 'admin-1', email: 'ops@idento.com', role: 'admin', is_super_admin: true, created_at: '2026-01-01T00:00:00Z' }], total: 1 };
const mockTenants = [{ tenant: { id: 't1', name: 'Acme Corp' } }];
const mockPlans = [{ id: 'plan-pro', name: 'Professional' }];

function mockApiGet() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/audit-log')) return Promise.resolve({ data: mockLogs });
    if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
    if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
    if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
    return Promise.reject(new Error('unexpected url ' + url));
  });
}

describe('AuditLog', () => {
  beforeEach(() => {
    mockApiGet();
  });

  it('renders fetched entries through AuditEntryList', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
  });

  it('re-fetches scoped to a tenant when one is picked from the combobox', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('combobox', { name: /all tenants/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('combobox', { name: /all tenants/i }));
    fireEvent.click(await screen.findByText('Acme Corp'));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.target_id).toBe('t1');
    });
  });

  it('includes the date range in the audit-log request when both dates are set', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '2026-07-11' } });
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.date_from).toBe('2026-07-01');
      expect(params.date_to).toBe('2026-07-11');
    });
  });

  it('disables Previous on the first page and enables Next when more rows exist', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/audit-log')) return Promise.resolve({ data: { ...mockLogs, total: 120 } });
      if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
      if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('requests the next page offset when Next is clicked', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/audit-log')) return Promise.resolve({ data: { ...mockLogs, total: 120 } });
      if (url.includes('/users')) return Promise.resolve({ data: mockAdmins });
      if (url.includes('/tenants')) return Promise.resolve({ data: mockTenants });
      if (url.includes('/plans')) return Promise.resolve({ data: mockPlans });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText(/Status: active → suspended/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => (u as string).includes('/audit-log'));
      const lastCall = calls[calls.length - 1];
      const params = (lastCall[1] as { params?: Record<string, unknown> })?.params ?? {};
      expect(params.offset).toBe(50);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/AuditLog.test.tsx`
Expected: FAIL — `AuditLog.tsx` doesn't fetch admins/tenants/plans, has no date inputs, no `AuditEntryList`, no pagination.

- [ ] **Step 3: Implement — replace `web/src/pages/super-admin/AuditLog.tsx` in full**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';
import { AuditEntryList } from '@/components/AuditEntryList';
import { TenantCombobox, type TenantOption } from '@/components/TenantCombobox';
import type { AuditLogEntry } from '@/lib/auditFormat';

const KNOWN_ACTIONS = [
  'create_tenant',
  'suspend_tenant',
  'reactivate_tenant',
  'archive_tenant',
  'impersonate_tenant',
  'impersonated_request',
  'create_subscription',
  'update_subscription',
  'create_plan',
  'update_plan',
];

const PAGE_SIZE = 50;

type Admin = { id: string; email: string; is_super_admin: boolean };

export default function AuditLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [planNames, setPlanNames] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .get('/api/super-admin/users', { params: { page_size: 100 } })
      .then((res) => setAdmins((res.data.users || []).filter((u: Admin) => u.is_super_admin)))
      .catch(() => {
        /* best-effort: actor filter just shows no options if this fails */
      });
    api
      .get('/api/super-admin/tenants')
      .then((res) =>
        setTenants(
          (res.data || [])
            .map((t: { tenant?: { id?: string; name?: string } }) => ({ id: t.tenant?.id, name: t.tenant?.name }))
            .filter((tn: TenantOption) => tn.id && tn.name)
        )
      )
      .catch(() => {
        /* best-effort: tenant filter just shows no options if this fails */
      });
    api
      .get('/api/super-admin/plans')
      .then((res) =>
        setPlanNames(Object.fromEntries((res.data || []).map((p: { id: string; name: string }) => [p.id, p.name])))
      )
      .catch(() => {
        /* best-effort: plan-change diffs fall back to a shortened plan id if this fails */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [actionFilter, actorFilter, tenantFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when any filter or the offset changes
  }, [actionFilter, actorFilter, tenantFilter, dateFrom, dateTo, offset]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset };
      if (actionFilter !== 'all') params.action = actionFilter;
      if (actorFilter !== 'all') params.admin_user_id = actorFilter;
      if (tenantFilter) params.target_id = tenantFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await api.get('/api/super-admin/audit-log', { params });
      setLogs(response.data.logs || []);
      setTotal(response.data.total || 0);
    } catch (error) {
      console.error('Failed to load audit log:', error);
      toast.error(t('failedToLoadData'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('auditLog')}</h1>
        <p className="text-muted-foreground">{t('adminActionsLog')}</p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('action')}</Label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allActions')}</SelectItem>
              {KNOWN_ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>{action}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('auditLog_actorLabel')}</Label>
          <Select value={actorFilter} onValueChange={setActorFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('auditLog_allAdmins')}</SelectItem>
              {admins.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('auditLog_tenantLabel')}</Label>
          <TenantCombobox tenants={tenants} value={tenantFilter} onChange={setTenantFilter} />
        </div>

        <div className="space-y-1">
          <Label htmlFor="audit-date-from" className="text-xs text-muted-foreground">{t('auditLog_dateFromLabel')}</Label>
          <Input
            id="audit-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-date-to" className="text-xs text-muted-foreground">{t('auditLog_dateToLabel')}</Label>
          <Input
            id="audit-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      <div className="border rounded-lg p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <AuditEntryList entries={logs} planNames={planNames} emptyLabel={t('noLogsFound')} />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t('paginationOf', {
            from: total === 0 ? 0 : offset + 1,
            to: Math.min(offset + PAGE_SIZE, total),
            total,
          })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            {t('previousPage')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            {t('nextPage')}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/AuditLog.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Full frontend gate and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/AuditLog.tsx src/pages/super-admin/__tests__/AuditLog.test.tsx && npx vitest run`
Expected: all pass (full suite — confirms Tasks 1-5's tests still pass).

```bash
git add web/src/pages/super-admin/AuditLog.tsx web/src/pages/super-admin/__tests__/AuditLog.test.tsx
git commit -m "feat(web): rebuild Audit Log page — actor/tenant/date filters, AuditEntryList, real pagination"
```

---

### Task 7: Frontend — Plans editor "Unlimited" toggle

**Files:**
- Modify: `web/src/pages/super-admin/SubscriptionPlans.tsx`
- Modify: `web/src/i18n.ts` (add one key)
- Test: `web/src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx` (new — no test exists for this page today)

**Interfaces:**
- Consumes: existing `Switch` (`web/src/components/ui/switch.tsx`, already imported in this file — it already drives the Active/Public toggles), existing `Input`/`Label`.
- Produces: a file-local `LimitField` component (not exported — used only within this file's edit/create dialog, three times) with signature `{ label: string; value: number; onChange: (value: number) => void }`. Nothing outside this file consumes it.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SubscriptionPlans from '../SubscriptionPlans';
import api from '@/lib/api';
import '../../../i18n';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

const mockPlans = [
  {
    id: 'plan-1',
    name: 'Starter',
    slug: 'starter',
    tier: 'starter',
    description: '',
    price_monthly: 29,
    price_yearly: 290,
    limits: { events_per_month: 10, attendees_per_event: 100, users: 3 },
    features: { custom_branding: false, api_access: false, priority_support: false },
    is_active: true,
    is_public: true,
    sort_order: 0,
  },
];

describe('SubscriptionPlans Unlimited toggle', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPlans });
  });

  it('shows the limit as a plain number with Unlimited off by default', async () => {
    render(<SubscriptionPlans />);
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const eventsInput = screen.getByDisplayValue('10');
    expect(eventsInput).not.toBeDisabled();
  });

  it('setting Unlimited disables the number input and clears it to -1', async () => {
    render(<SubscriptionPlans />);
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const eventsInput = screen.getByDisplayValue('10');
    const unlimitedToggle = screen.getByLabelText(/events per month.*unlimited/i);
    fireEvent.click(unlimitedToggle);
    expect(eventsInput).toBeDisabled();
  });

  it('a limit already at -1 initializes with Unlimited on and the input disabled', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ ...mockPlans[0], limits: { ...mockPlans[0].limits, events_per_month: -1 } }],
    });
    render(<SubscriptionPlans />);
    await waitFor(() => expect(screen.getByText('Starter')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const unlimitedToggle = screen.getByLabelText(/events per month.*unlimited/i);
    expect(unlimitedToggle).toHaveAttribute('data-state', 'checked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx`
Expected: FAIL — no Unlimited toggle exists yet, `getByLabelText(/events per month.*unlimited/i)` finds nothing.

- [ ] **Step 3: Add the i18n key**

`en.translation`, immediately after Task 5's `auditLog_dateToLabel` line:

```ts
          planLimitUnlimited: "Unlimited",
```

`ru.translation`, same relative position:

```ts
          planLimitUnlimited: "Без ограничений",
```

- [ ] **Step 4: Add the `LimitField` component**

In `web/src/pages/super-admin/SubscriptionPlans.tsx`, add this function above `export default function SubscriptionPlans()`:

```tsx
type LimitFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

function LimitField({ label, value, onChange }: LimitFieldProps) {
  const { t } = useTranslation();
  const isUnlimited = value === -1;

  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={isUnlimited ? '' : value}
          disabled={isUnlimited}
          placeholder={isUnlimited ? t('planLimitUnlimited') : undefined}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        />
        <div className="flex items-center gap-1.5">
          <Switch
            checked={isUnlimited}
            onCheckedChange={(checked) => onChange(checked ? -1 : 0)}
            aria-label={`${label} — ${t('planLimitUnlimited')}`}
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">{t('planLimitUnlimited')}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the three limit fields through it**

Replace the limits grid inside the create/edit `Dialog`:

```tsx
            <div className="space-y-2">
              <Label>{t('limits')}</Label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">{t('eventsPerMonth')}</Label>
                  <Input
                    type="number"
                    value={formData.limits?.events_per_month || 0}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, events_per_month: parseInt(e.target.value) }
                    })}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('attendeesPerEvent')}</Label>
                  <Input
                    type="number"
                    value={formData.limits?.attendees_per_event || 0}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, attendees_per_event: parseInt(e.target.value) }
                    })}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('users')}</Label>
                  <Input
                    type="number"
                    value={formData.limits?.users || 0}
                    onChange={(e) => setFormData({
                      ...formData,
                      limits: { ...formData.limits, users: parseInt(e.target.value) }
                    })}
                  />
                </div>
              </div>
            </div>
```

with:

```tsx
            <div className="space-y-2">
              <Label>{t('limits')}</Label>
              <div className="grid grid-cols-3 gap-2">
                <LimitField
                  label={t('eventsPerMonth')}
                  value={formData.limits?.events_per_month ?? 0}
                  onChange={(v) => setFormData({ ...formData, limits: { ...formData.limits, events_per_month: v } })}
                />
                <LimitField
                  label={t('attendeesPerEvent')}
                  value={formData.limits?.attendees_per_event ?? 0}
                  onChange={(v) => setFormData({ ...formData, limits: { ...formData.limits, attendees_per_event: v } })}
                />
                <LimitField
                  label={t('users')}
                  value={formData.limits?.users ?? 0}
                  onChange={(v) => setFormData({ ...formData, limits: { ...formData.limits, users: v } })}
                />
              </div>
            </div>
```

Leave the card grid's read-only limits display (`{value === -1 ? t('unlimited') : value}`) untouched — it already renders `-1` as "Unlimited" correctly.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 7: Full frontend gate, live-browser check, and commit**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/super-admin/SubscriptionPlans.tsx src/i18n.ts src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx && npx vitest run`
Expected: all pass (full suite — confirms Tasks 1-6's tests still pass).

Per this session's established verification pattern, before committing this final task, manually verify in a running dev server: open the Audit Log page, exercise each filter individually and in combination (action, actor, tenant, date range), confirm pagination Previous/Next reflect the real `total`, confirm a plan create/update shows up with a human-readable diff; open the Plans editor, toggle Unlimited on an existing finite limit and save, re-open and confirm it shows Unlimited; toggle it back off and confirm a sane default (not a stale `-1`) is saved. Repeat the Plans editor check in light/dark and EN/RU. Flag any deviation found back to the user before merging — do not silently fix product-shape issues found here.

```bash
git add web/src/pages/super-admin/SubscriptionPlans.tsx web/src/i18n.ts web/src/pages/super-admin/__tests__/SubscriptionPlans.test.tsx
git commit -m "feat(web): add Unlimited toggle to Plans editor limit fields"
```

---

## End of Batch 3

After Task 7, both deliverables are feature-complete per the design spec: the Audit Log page is filterable by actor/action/tenant/date with human-readable diffs (reusing Batch 2's `AuditEntryList` unmodified) and real server-side pagination; the Plans editor makes `-1`/unlimited an explicit, discoverable toggle instead of a magic number.

**Known, documented-not-fixed gaps** (per spec's Out of Scope — flag to the user before merging, do not silently address):
- Impersonation session-grouping (collapsing an `impersonate_tenant` row with its `impersonated_request` children) — deferred, real future work.
- No dynamic/arbitrary limit or feature keys in the Plans editor — fixed set only.
- No calendar/date-range-picker component — native date inputs, timezone-naive (UTC-day) semantics.
- No plan deletion/archival UI — matches current behavior.

**Batch 4 (if any — not yet planned):** no further deliverables remain from `docs/design-briefs/saas-tenant-admin.md`'s original 7-item list beyond what Batches 1-3 have covered (Overview, Tenants list, Tenant detail workbench, Impersonation ceremony, Plans editor, Audit log, and the shared component additions). Any future work here would be net-new scope, not a carryover.

