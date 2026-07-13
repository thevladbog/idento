# Tenant Archival Retention & Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the retention half of P1.4 tenant archival: `archived_at` timestamp, `TENANT_RETENTION_DAYS` config (default 90, 0 disables), reactivation of archived tenants until purge, and a daily purge goroutine that cascade-deletes expired archived tenants with audit logging.

**Architecture:** A migration adds `tenants.archived_at` (stamped/cleared inside the existing `UpdateTenantStatus` SQL) and makes `admin_audit_log.admin_user_id` nullable for system-actor entries. A single new store method `PurgeExpiredTenants` does select→detach-shared-users→cascade-delete→audit per tenant in one transaction each. A tiny `internal/retention` package runs it on a ticker from `main.go`.

**Tech Stack:** Go 1.25, echo, pgx v5, pgxmock v4 (store tests), plain `testing` with the handler package's `fakeStore`.

**Spec:** `docs/superpowers/specs/2026-07-13-tenant-archival-retention-design.md` (owner-approved).

## Global Constraints

- Default retention: **90 days**; `TENANT_RETENTION_DAYS=0` disables auto-purge; negative/non-numeric → `config.Load` error.
- Identical behavior in `saas` and `onprem` modes.
- "Within retention" ≡ "tenant row still exists" — the reactivate path does **no** date math.
- Purge = full cascade delete, but users who are super admins or members of other tenants are detached (`users.tenant_id = NULL`) first, never deleted.
- Purge audit entries use `admin_user_id = NULL`, action `purge_tenant`.
- All work happens in `backend/`; run Go commands from the `backend/` directory.
- Commit after each task (messages given per task).

---

### Task 1: Migration 000017

**Files:**
- Create: `backend/migrations/000017_tenant_archival_retention.up.sql`
- Create: `backend/migrations/000017_tenant_archival_retention.down.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `tenants.archived_at TIMESTAMPTZ NULL` and nullable `admin_audit_log.admin_user_id` — later tasks' SQL depends on both.

- [ ] **Step 1: Write the up migration**

`backend/migrations/000017_tenant_archival_retention.up.sql`:

```sql
-- Retention half of P1.4 tenant archival (soft-delete + retention policy).
-- archived_at is stamped on archive and cleared on reactivate; the purge job
-- deletes archived tenants once NOW() - archived_at exceeds the configured
-- retention. Pre-existing archived tenants start their clock at deploy time.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE tenants SET archived_at = NOW() WHERE status = 'archived' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_archived_at ON tenants(archived_at) WHERE status = 'archived';

-- System-initiated purges are audit-logged without an admin actor.
ALTER TABLE admin_audit_log ALTER COLUMN admin_user_id DROP NOT NULL;
```

- [ ] **Step 2: Write the down migration**

`backend/migrations/000017_tenant_archival_retention.down.sql`:

```sql
-- NULL-actor rows must go before NOT NULL can be restored.
DELETE FROM admin_audit_log WHERE admin_user_id IS NULL;
ALTER TABLE admin_audit_log ALTER COLUMN admin_user_id SET NOT NULL;
DROP INDEX IF EXISTS idx_tenants_archived_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS archived_at;
```

- [ ] **Step 3: Verify migration embed/ordering tests still pass**

Run (from `backend/`): `go test ./migrations/... ./internal/store/ -run 'Migration|Embed' -v`
Expected: PASS (the embed glob is `*.up.sql`; new pair is sequential after 000016).

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/000017_tenant_archival_retention.up.sql backend/migrations/000017_tenant_archival_retention.down.sql
git commit -m "feat(db): archived_at on tenants + nullable audit actor for retention purge"
```

---

### Task 2: Config — TENANT_RETENTION_DAYS

**Files:**
- Modify: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `Config.TenantRetentionDays int` — read by Task 7 (`cfg.TenantRetentionDays`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/config/config_test.go`:

```go
func TestLoadTenantRetentionDays(t *testing.T) {
	cases := []struct {
		name    string
		env     string
		want    int
		wantErr bool
	}{
		{name: "unset defaults to 90", env: "", want: 90},
		{name: "explicit value honored", env: "30", want: 30},
		{name: "zero disables auto-purge", env: "0", want: 0},
		{name: "negative rejected", env: "-1", wantErr: true},
		{name: "non-numeric rejected", env: "ninety", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setRequiredEnv(t)
			t.Setenv("TENANT_RETENTION_DAYS", tc.env)
			cfg, err := Load()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Load() succeeded with TENANT_RETENTION_DAYS=%q, want error", tc.env)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error: %v", err)
			}
			if cfg.TenantRetentionDays != tc.want {
				t.Errorf("TenantRetentionDays = %d, want %d", cfg.TenantRetentionDays, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/config/ -run TestLoadTenantRetentionDays -v`
Expected: FAIL — `cfg.TenantRetentionDays undefined`.

- [ ] **Step 3: Implement**

In `backend/internal/config/config.go`:
- Add `"strconv"` to imports.
- Add field to `Config` (after `DeploymentMode string`):

```go
	// TenantRetentionDays is how long an archived tenant is kept before the
	// purge job deletes it permanently. 0 disables auto-purge.
	TenantRetentionDays int
```

- In `Load()`, after the `DeploymentMode` switch and before `current = cfg`:

```go
	switch raw := os.Getenv("TENANT_RETENTION_DAYS"); raw {
	case "":
		cfg.TenantRetentionDays = 90
	default:
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return nil, fmt.Errorf("TENANT_RETENTION_DAYS must be a non-negative integer (0 disables auto-purge), got %q", raw)
		}
		cfg.TenantRetentionDays = n
	}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/config/ -v`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/config/config.go backend/internal/config/config_test.go
git commit -m "feat(config): TENANT_RETENTION_DAYS (default 90, 0 disables purge)"
```

---

### Task 3: archived_at in model, UpdateTenantStatus, and tenant list

**Files:**
- Modify: `backend/internal/models/models.go` (Tenant ~line 9, AdminAuditLog ~line 158)
- Modify: `backend/internal/store/pg_store.go` (`UpdateTenantStatus` ~line 330, `GetAllTenants` ~line 962)
- Test: create `backend/internal/store/pg_store_tenant_lifecycle_test.go`

**Interfaces:**
- Consumes: `tenants.archived_at` column (Task 1).
- Produces: `models.Tenant.ArchivedAt *time.Time`; `models.AdminAuditLog.AdminUserID *uuid.UUID`; `UpdateTenantStatus` stamping semantics that Task 4's reactivate relies on.

- [ ] **Step 1: Write the failing pgxmock test**

Create `backend/internal/store/pg_store_tenant_lifecycle_test.go`:

```go
package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// UpdateTenantStatus must stamp archived_at when archiving and clear it on
// any other transition (reactivate), in the same statement.
func TestUpdateTenantStatusStampsAndClearsArchivedAt(t *testing.T) {
	for _, status := range []string{"archived", "active"} {
		t.Run(status, func(t *testing.T) {
			mock, err := pgxmock.NewPool()
			if err != nil {
				t.Fatalf("pgxmock.NewPool: %v", err)
			}
			defer mock.Close()
			id := uuid.New()
			mock.ExpectExec(`UPDATE tenants\s+SET status = \$2,\s+archived_at = CASE WHEN \$2 = 'archived' THEN NOW\(\) ELSE NULL END,\s+updated_at = NOW\(\)\s+WHERE id = \$1`).
				WithArgs(id, status).
				WillReturnResult(pgxmock.NewResult("UPDATE", 1))

			s := &PGStore{db: mock}
			if err := s.UpdateTenantStatus(context.Background(), id, status); err != nil {
				t.Fatalf("UpdateTenantStatus: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unmet expectations: %v", err)
			}
		})
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/store/ -run TestUpdateTenantStatusStampsAndClearsArchivedAt -v`
Expected: FAIL — the executed SQL does not match the expected pattern.

- [ ] **Step 3: Implement**

In `backend/internal/models/models.go`:
- `Tenant`: after `Status string \`json:"status"\`` add:

```go
	ArchivedAt   *time.Time             `json:"archived_at,omitempty"`
```

- `AdminAuditLog`: change `AdminUserID uuid.UUID` to:

```go
	AdminUserID *uuid.UUID             `json:"admin_user_id"`
```

(NULL actor = system purge. `TargetID *uuid.UUID` in the same struct is the existing precedent for nullable scans.)

In `backend/internal/store/pg_store.go`:
- `UpdateTenantStatus` body SQL becomes:

```go
	tag, err := s.db.Exec(ctx, `UPDATE tenants
		SET status = $2,
		    archived_at = CASE WHEN $2 = 'archived' THEN NOW() ELSE NULL END,
		    updated_at = NOW()
		WHERE id = $1`, id, status)
```

(keep the existing RowsAffected/not-found handling unchanged).
- `GetAllTenants`: in the SELECT, change `t.status AS tenant_status,` to `t.status AS tenant_status, t.archived_at,` and in `rows.Scan(...)` add `&t.ArchivedAt` immediately after `&t.Status`.

- [ ] **Step 4: Run tests and build**

Run: `go build ./... && go test ./internal/store/ ./internal/models/... ./internal/handler/ -count=1`
Expected: PASS. If any code still assigns a bare `uuid.UUID` to `AdminUserID`, the build breaks — fix by taking the address (`&id`). (Survey found none: only the scan site and tests that filter by string.)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/models/models.go backend/internal/store/pg_store.go backend/internal/store/pg_store_tenant_lifecycle_test.go
git commit -m "feat(store): stamp/clear tenants.archived_at in UpdateTenantStatus; expose in model"
```

---

### Task 4: Reactivate archived tenants (until purge)

**Files:**
- Modify: `backend/internal/handler/super_admin.go` (`tenantTransitions` ~line 418, `setTenantStatus` ~line 442)
- Test: `backend/internal/handler/super_admin_lifecycle_test.go`

**Interfaces:**
- Consumes: `fakeStore.getTenantStatus` / `updateTenantStatus` / `logAdminAction` fields (existing, `testsupport_test.go:44-56`).
- Produces: `reactivate` accepted from `suspended` **or** `archived`. No signature changes.

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/handler/super_admin_lifecycle_test.go`:

```go
// Archived tenants are reactivatable until the purge job removes them:
// "within retention" simply means the row still exists.
func TestReactivateTenantFromArchived(t *testing.T) {
	target := uuid.New()
	var saved string
	fs := &fakeStore{
		getTenantStatus:    func(id uuid.UUID) (string, error) { return "archived", nil },
		updateTenantStatus: func(id uuid.UUID, s string) error { saved = s; return nil },
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			return nil
		},
	}
	h, c, code := lifecycleCtx(t, fs, target, "reactivate")
	if err := h.ReactivateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if code() != http.StatusOK || saved != "active" {
		t.Fatalf("status=%d saved=%q; want 200/active", code(), saved)
	}
}

func TestReactivateTenantFromActiveConflicts(t *testing.T) {
	target := uuid.New()
	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
	}
	h, c, code := lifecycleCtx(t, fs, target, "reactivate")
	if err := h.ReactivateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if code() != http.StatusConflict {
		t.Fatalf("status=%d; want 409 (reactivate only from suspended/archived)", code())
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/handler/ -run 'TestReactivateTenant' -v`
Expected: `TestReactivateTenantFromArchived` FAILS with status=409; `...FromActiveConflicts` passes (it documents behavior that must survive the change).

- [ ] **Step 3: Implement**

In `backend/internal/handler/super_admin.go`, add `"slices"` to imports, then replace the transition table and its check:

```go
// lifecycle transition table: action → (allowed current states, new state).
// Reactivate accepts archived because archival is a soft-delete: until the
// retention purge removes the row, the tenant can come back.
var tenantTransitions = map[string]struct {
	froms []string
	to    string
}{
	"suspend":    {froms: []string{"active"}, to: "suspended"},
	"reactivate": {froms: []string{"suspended", "archived"}, to: "active"},
	"archive":    {froms: []string{"suspended"}, to: "archived"},
}
```

and in `setTenantStatus`, replace `if current != tr.from {` block with:

```go
	if !slices.Contains(tr.froms, current) {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": fmt.Sprintf(`cannot %s a tenant in state %q (requires "%s")`, action, current, strings.Join(tr.froms, `" or "`)),
		})
	}
```

(`strings` is already imported in this file.)

- [ ] **Step 4: Run tests**

Run: `go test ./internal/handler/ -count=1`
Expected: PASS — including the pre-existing `TestSuspendTenantFromActive` and `TestArchiveRequiresSuspended`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/super_admin.go backend/internal/handler/super_admin_lifecycle_test.go
git commit -m "feat(super-admin): allow reactivating archived tenants until purge"
```

---

### Task 5: Store — PurgeExpiredTenants

> **Note:** the implementation snippet in Step 3 reflects the *final* shipped code, including the whole-branch-review hardening (guarded in-tx DELETE with `errTenantNoLongerEligible` skip, audit-actor detach clause, `retentionDays <= 0` guard — commit `e548f65` and follow-ups). The Step 1 test code shows the original plan-time expectations; see `backend/internal/store/pg_store_retention_test.go` for the final tests.

**Files:**
- Create: `backend/internal/store/pg_store_retention.go`
- Modify: `backend/internal/store/interface.go` (Store interface, near `UpdateTenantStatus` line 31)
- Test: create `backend/internal/store/pg_store_retention_test.go`

**Interfaces:**
- Consumes: `archived_at` column and nullable audit actor (Task 1); `dbConn.Begin` (exists, `pg_store.go:27`).
- Produces (Task 6 depends on these exact shapes):

```go
type PurgedTenant struct {
	ID   uuid.UUID
	Name string
}
PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]PurgedTenant, error)
```

- [ ] **Step 1: Write the failing pgxmock tests**

Create `backend/internal/store/pg_store_retention_test.go`:

```go
package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

const listExpiredSQL = `SELECT id, name, archived_at FROM tenants\s+WHERE status = 'archived' AND archived_at < NOW\(\) - make_interval\(days => \$1\)`

func expectPurgeTx(mock pgxmock.PgxPoolIface, id uuid.UUID) {
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE users SET tenant_id = NULL`).
		WithArgs(id).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(`DELETE FROM tenants WHERE id = \$1`).
		WithArgs(id).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectExec(`INSERT INTO admin_audit_log \(admin_user_id, action, target_type, target_id, changes\)`).
		WithArgs(id, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
}

func TestPurgeExpiredTenantsPurgesEachInOneTx(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	idA, idB := uuid.New(), uuid.New()
	archived := time.Now().Add(-100 * 24 * time.Hour)
	mock.ExpectQuery(listExpiredSQL).
		WithArgs(90).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "archived_at"}).
			AddRow(idA, "Org A", archived).
			AddRow(idB, "Org B", archived))
	expectPurgeTx(mock, idA)
	expectPurgeTx(mock, idB)

	s := &PGStore{db: mock}
	purged, err := s.PurgeExpiredTenants(context.Background(), 90)
	if err != nil {
		t.Fatalf("PurgeExpiredTenants: %v", err)
	}
	if len(purged) != 2 || purged[0].Name != "Org A" || purged[1].ID != idB {
		t.Errorf("purged = %+v; want Org A and Org B", purged)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestPurgeExpiredTenantsSkipsFailedTenantAndContinues(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	idA, idB := uuid.New(), uuid.New()
	archived := time.Now().Add(-100 * 24 * time.Hour)
	mock.ExpectQuery(listExpiredSQL).
		WithArgs(90).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "archived_at"}).
			AddRow(idA, "Org A", archived).
			AddRow(idB, "Org B", archived))

	// Tenant A: delete fails mid-transaction → rollback, move on.
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE users SET tenant_id = NULL`).
		WithArgs(idA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(`DELETE FROM tenants WHERE id = \$1`).
		WithArgs(idA).
		WillReturnError(errors.New("fk violation"))
	mock.ExpectRollback()
	// Tenant B still purges.
	expectPurgeTx(mock, idB)

	s := &PGStore{db: mock}
	purged, err := s.PurgeExpiredTenants(context.Background(), 90)
	if err == nil {
		t.Fatal("want combined error for tenant A, got nil")
	}
	if len(purged) != 1 || purged[0].ID != idB {
		t.Errorf("purged = %+v; want only Org B", purged)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/store/ -run TestPurgeExpiredTenants -v`
Expected: FAIL — `s.PurgeExpiredTenants undefined`.

- [ ] **Step 3: Implement**

Create `backend/internal/store/pg_store_retention.go`:

```go
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// PurgedTenant identifies a tenant removed by the retention purge.
type PurgedTenant struct {
	ID   uuid.UUID
	Name string
}

// errTenantNoLongerEligible signals that a purge candidate stopped matching
// the purge conditions between listing and deletion (e.g. it was reactivated).
var errTenantNoLongerEligible = errors.New("tenant no longer eligible for purge")

// PurgeExpiredTenants hard-deletes tenants archived more than retentionDays
// ago. Per tenant, in one transaction: users that must survive (super admins,
// members of other tenants) are detached, the tenant row is deleted (FKs
// cascade all tenant data), and a purge_tenant audit entry with no admin
// actor is written. One tenant failing does not stop the rest; the combined
// error is returned alongside the successfully purged list.
func (s *PGStore) PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]PurgedTenant, error) {
	// Defense in depth: retentionDays <= 0 means "auto-purge disabled". The
	// worker never calls us then, but without this guard a zero interval
	// would match (and delete) every archived tenant.
	if retentionDays <= 0 {
		return nil, nil
	}
	rows, err := s.db.Query(ctx, `SELECT id, name, archived_at FROM tenants
		WHERE status = 'archived' AND archived_at < NOW() - make_interval(days => $1)`, retentionDays)
	if err != nil {
		return nil, fmt.Errorf("list expired archived tenants: %w", err)
	}
	type candidate struct {
		id         uuid.UUID
		name       string
		archivedAt time.Time
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.name, &c.archivedAt); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var purged []PurgedTenant
	var errs []error
	for _, c := range candidates {
		if err := s.purgeTenant(ctx, c.id, c.name, c.archivedAt, retentionDays); err != nil {
			if errors.Is(err, errTenantNoLongerEligible) {
				continue
			}
			errs = append(errs, fmt.Errorf("purge tenant %s (%s): %w", c.id, c.name, err))
			continue
		}
		purged = append(purged, PurgedTenant{ID: c.id, Name: c.name})
	}
	return purged, errors.Join(errs...)
}

func (s *PGStore) purgeTenant(ctx context.Context, id uuid.UUID, name string, archivedAt time.Time, retentionDays int) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	//nolint:errcheck
	defer tx.Rollback(ctx) // no-op after Commit

	// Detach users that must survive the cascade: super admins, users with
	// memberships in other tenants, and users with admin_audit_log actor rows
	// (e.g. a demoted ex-super-admin) — that table's NO ACTION FK would
	// otherwise block the tenant delete. Their user_tenants row for this
	// tenant still cascades away with the tenant.
	if _, err := tx.Exec(ctx, `UPDATE users SET tenant_id = NULL
		WHERE tenant_id = $1
		  AND (is_super_admin OR EXISTS (
		      SELECT 1 FROM user_tenants ut WHERE ut.user_id = users.id AND ut.tenant_id <> $1)
		  OR EXISTS (
		      SELECT 1 FROM admin_audit_log al WHERE al.admin_user_id = users.id))`, id); err != nil {
		return fmt.Errorf("detach shared users: %w", err)
	}

	tag, err := tx.Exec(ctx, `DELETE FROM tenants
		WHERE id = $1 AND status = 'archived' AND archived_at < NOW() - make_interval(days => $2)`, id, retentionDays)
	if err != nil {
		return fmt.Errorf("delete tenant: %w", err)
	}
	// Re-verified inside the transaction: if the tenant was reactivated (or
	// already purged by another replica) since the candidate SELECT, roll
	// back the detach and skip — no audit entry, not counted as purged.
	if tag.RowsAffected() == 0 {
		return errTenantNoLongerEligible
	}

	changes, err := json.Marshal(map[string]interface{}{
		"name":           name,
		"archived_at":    archivedAt,
		"retention_days": retentionDays,
	})
	if err != nil {
		return err
	}
	// The permanent record that survives the purge (admin_user_id NULL =
	// system actor; column made nullable in migration 000017).
	if _, err := tx.Exec(ctx, `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, changes)
		VALUES (NULL, 'purge_tenant', 'tenant', $1, $2)`, id, changes); err != nil {
		return fmt.Errorf("write purge audit entry: %w", err)
	}
	return tx.Commit(ctx)
}
```

In `backend/internal/store/interface.go`, after `UpdateTenantStatus` (line 31) add:

```go
	// PurgeExpiredTenants hard-deletes tenants archived more than
	// retentionDays ago; see PGStore for detach/cascade/audit semantics.
	PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]PurgedTenant, error)
```

(`fakeStore` in the handler package embeds `store.Store`, so it satisfies the new method automatically.)

- [ ] **Step 4: Run tests**

Run: `go build ./... && go test ./internal/store/ -run TestPurgeExpiredTenants -v && go test ./internal/store/ -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/pg_store_retention.go backend/internal/store/pg_store_retention_test.go backend/internal/store/interface.go
git commit -m "feat(store): PurgeExpiredTenants — detach shared users, cascade delete, audit"
```

---

### Task 6: Retention worker package

**Files:**
- Create: `backend/internal/retention/retention.go`
- Test: create `backend/internal/retention/retention_test.go`

**Interfaces:**
- Consumes: `store.PurgedTenant`, `PurgeExpiredTenants` signature (Task 5).
- Produces (Task 7 calls this): `retention.Start(s Store, retentionDays int, initialDelay, interval time.Duration) bool`.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/retention/retention_test.go`:

```go
package retention

import (
	"context"
	"errors"
	"testing"
	"time"

	"idento/backend/internal/store"
)

type fakePurger struct {
	calls chan int
	err   error
}

func (f *fakePurger) PurgeExpiredTenants(_ context.Context, retentionDays int) ([]store.PurgedTenant, error) {
	f.calls <- retentionDays
	return nil, f.err
}

func TestStartDisabledWhenRetentionZero(t *testing.T) {
	f := &fakePurger{calls: make(chan int, 1)}
	if Start(f, 0, time.Millisecond, time.Millisecond) {
		t.Fatal("Start(days=0) = true, want false (disabled)")
	}
	select {
	case <-f.calls:
		t.Fatal("purge ran despite retention 0")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestStartRunsFirstPassAfterInitialDelay(t *testing.T) {
	f := &fakePurger{calls: make(chan int, 1)}
	if !Start(f, 90, time.Millisecond, time.Hour) {
		t.Fatal("Start(days=90) = false, want true")
	}
	select {
	case days := <-f.calls:
		if days != 90 {
			t.Errorf("purge called with %d days, want 90", days)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first purge pass never ran")
	}
}

func TestRunOnceSurvivesStoreError(t *testing.T) {
	f := &fakePurger{calls: make(chan int, 1), err: errors.New("db down")}
	RunOnce(context.Background(), f, 90) // must log, not panic
	if got := <-f.calls; got != 90 {
		t.Errorf("purge called with %d days, want 90", got)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/retention/ -v`
Expected: FAIL — package does not exist yet / `Start` undefined.

- [ ] **Step 3: Implement**

Create `backend/internal/retention/retention.go`:

```go
// Package retention removes archived tenants whose retention window has
// expired (the retention half of P1.4 soft-delete). It is the backend's only
// background job: one ticker loop started from main.go.
package retention

import (
	"context"
	"log"
	"time"

	"idento/backend/internal/store"
)

// Store is the slice of the data layer the purge loop needs.
type Store interface {
	PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]store.PurgedTenant, error)
}

// Start launches the purge loop in a goroutine and reports whether it did.
// No-op when retentionDays <= 0. The first pass runs after initialDelay
// (lets the server settle at boot), then every interval.
func Start(s Store, retentionDays int, initialDelay, interval time.Duration) bool {
	if retentionDays <= 0 {
		log.Println("Tenant retention purge disabled (TENANT_RETENTION_DAYS=0)")
		return false
	}
	log.Printf("Tenant retention purge enabled: archived tenants are deleted after %d days", retentionDays)
	go func() {
		time.Sleep(initialDelay)
		RunOnce(context.Background(), s, retentionDays)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			RunOnce(context.Background(), s, retentionDays)
		}
	}()
	return true
}

// RunOnce executes a single purge pass. Idle passes are silent; passes that
// purge tenants or hit errors log one summary line.
func RunOnce(ctx context.Context, s Store, retentionDays int) {
	purged, err := s.PurgeExpiredTenants(ctx, retentionDays)
	if err != nil {
		log.Printf("Tenant retention purge: %d purged, errors: %v", len(purged), err)
		return
	}
	if len(purged) > 0 {
		log.Printf("Tenant retention purge: deleted %d archived tenant(s) past %d-day retention", len(purged), retentionDays)
	}
}
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/retention/ -v -count=1`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/retention/
git commit -m "feat(retention): daily purge worker for expired archived tenants"
```

---

### Task 7: Wire into main.go, document the env var

**Files:**
- Modify: `backend/main.go` (imports ~line 3; wiring after `h := handler.New(pgStore)` ~line 429)
- Modify: `.env.example` (after the DEPLOYMENT_MODE block, ~line 16)
- Modify: `docs/DUAL_DISTRIBUTION_REWORK.md` (P1.4 section, ~line 63)

**Interfaces:**
- Consumes: `retention.Start` (Task 6), `cfg.TenantRetentionDays` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Wire the worker**

In `backend/main.go` add imports `"time"` and `"idento/backend/internal/retention"`, then after `h := handler.New(pgStore)` insert:

```go
	// Tenant retention purge (P1.4 soft-delete): first pass a minute after
	// boot, then daily. Logs and no-ops when retention is 0.
	retention.Start(pgStore, cfg.TenantRetentionDays, time.Minute, 24*time.Hour)
```

- [ ] **Step 2: Document the env var**

In `.env.example`, after the `# DEPLOYMENT_MODE=saas` line add:

```text
# Days an archived tenant is kept before the daily purge deletes it and all
# its data permanently (default: 90; 0 disables auto-purge)
# TENANT_RETENTION_DAYS=90
```

In `docs/DUAL_DISTRIBUTION_REWORK.md`, at the end of the "### P1.4 Tenant lifecycle for operators" section body, append:

```text
- **2026-07-13:** retention policy implemented — `archived_at` stamp, `TENANT_RETENTION_DAYS` (default 90, 0 disables), daily purge with audit trail, reactivate-until-purged. Spec: `docs/superpowers/specs/2026-07-13-tenant-archival-retention-design.md`.
```

- [ ] **Step 3: Build and verify startup wiring compiles**

Run: `go build ./... && go vet ./...`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/main.go .env.example docs/DUAL_DISTRIBUTION_REWORK.md
git commit -m "feat: start tenant retention purge from main; document TENANT_RETENTION_DAYS"
```

---

### Task 8: Full verification

**Files:** none new.

- [ ] **Step 1: Run the full backend suite**

Run (from `backend/`): `go build ./... && go vet ./... && go test ./... -count=1`
Expected: all packages PASS, no vet findings.

- [ ] **Step 2: Runtime smoke test (if local Postgres from start-all.sh is available)**

Start the backend (`DATABASE_URL` per `.env`), confirm the startup log prints `Tenant retention purge enabled: archived tenants are deleted after 90 days`, and that migration 000017 applies cleanly. With `TENANT_RETENTION_DAYS=0`, confirm the disabled log line instead. If no local DB is available, note that in the completion report.

- [ ] **Step 3: Commit any fixups**

Only if steps 1–2 surfaced fixes; message: `fix: <what the full suite surfaced>`.
