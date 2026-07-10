# Phase B — Backend Contract for Mobile Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend API surface the mobile redesign needs — time-windowed zone access rules, station provisioning, idempotent batch check-in, check-in override audit log, and event/zone stats — without touching any existing endpoint's behavior.

**Architecture:** One new migration (`000013`) adding two columns and five tables; new `Store` interface methods on the existing `PGStore`; new handler methods registered in the existing `RegisterRoutes`; a small web-console addition (generate a station-provisioning QR) that mirrors the existing local-QR-render pattern. All new mutating endpoints follow the existing `requireEventOwnership`/`requireZoneOwnership` tenant-isolation pattern.

**Tech Stack:** Go 1.25.4 (toolchain 1.26.5), Echo v4.15.4, pgx v5.10.0, golang-jwt v5.3.1, Postgres 16 (local via `docker-compose.yml`, port 5438). React/TypeScript for the one web-console task.

## Global Constraints

- Do not modify the existing `/api/zones/checkin` handler, `CheckZoneAccess` store method, or any existing endpoint's request/response shape — this phase is strictly additive.
- Every new mutating/tenant-scoped endpoint MUST gate through `requireEventOwnership` / `requireZoneOwnership` (`backend/internal/handler/authz.go`) and return errors via `writeErr(c, err)`, exactly like existing handlers (see `backend/internal/handler/zones.go:18-40`).
- New tables are added via `backend/migrations/000013_mobile_stations.up.sql` (next version after `000012`), embedded automatically via `//go:embed *.up.sql` — no code registration needed. Migrations must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), matching existing convention.
- Handler tests use the existing `fakeStore` + `newAuthedContext`/`newAuthedContextWithUserID` harness (`backend/internal/handler/testsupport_test.go`) — no real database in `go test ./...`. Real-Postgres verification (for the migration SQL itself) is a manual one-time step per task, run against the local `docker-compose` Postgres — this matches the codebase's existing convention of zero DB-dependent Go tests.
- JWT claims are `{user_id, tenant_id, role}` only (`backend/internal/models/auth.go`) — no email/name. Any "staff name" surfaced to mobile is the user's `email` field, since `models.User` has no name field today.
- New JSON field names use `snake_case` throughout (matches every existing model).
- Run `cd backend && go build ./... && go vet ./... && go test ./...` after every task; run `golangci-lint run ./...` and `gosec ./...` before the final task's PR.
- **Explicit design decision (flagging for product review):** the provisioning-token endpoint requires the manager to pick an existing staff user (from `GET /api/users`) when generating the QR — the minted "staff JWT" authenticates as *that* user, not the manager. This was chosen over "device impersonates the generating manager" because it makes `checked_in_by`/override-log entries and the mobile settings screen's staff name correctly reflect who is actually operating the station.

---

### Task 1: Migration 000013 — schema for stations, provisioning, overrides, batch log, zone-scan log

**Files:**
- Create: `backend/migrations/000013_mobile_stations.up.sql`
- Modify: `backend/internal/models/models.go` (append new structs; extend `ZoneAccessRule`)

**Interfaces:**
- Produces: tables `stations`, `station_provisioning_tokens`, `checkin_overrides`, `batch_checkin_log`, `zone_scan_log`; new columns `zone_access_rules.time_from`, `zone_access_rules.time_to` (both `VARCHAR(5)`, `"HH:MM"` format, nullable — same convention as `EventZone.OpenTime`/`CloseTime`). Later tasks consume these via new `Store` methods (Task 2+).

- [ ] **Step 1: Write the migration file**

```sql
-- backend/migrations/000013_mobile_stations.up.sql
-- Phase B (mobile redesign): time-windowed zone access rules, station
-- provisioning/registry, check-in override audit log, idempotent batch
-- check-in log, and a zone-scan log feeding live KPI stats.

ALTER TABLE zone_access_rules ADD COLUMN IF NOT EXISTS time_from VARCHAR(5);
ALTER TABLE zone_access_rules ADD COLUMN IF NOT EXISTS time_to VARCHAR(5);

CREATE TABLE IF NOT EXISTS stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    device_number INT NOT NULL,
    staff_user_id UUID NOT NULL REFERENCES users(id),
    device_info JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(event_id, device_number)
);

CREATE TABLE IF NOT EXISTS station_provisioning_tokens (
    token VARCHAR(64) PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkin_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    context VARCHAR(30) NOT NULL,
    staff_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batch_checkin_log (
    client_uuid UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    device_number INT,
    checked_in_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zone_scan_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID NOT NULL REFERENCES event_zones(id) ON DELETE CASCADE,
    attendee_id UUID REFERENCES attendees(id) ON DELETE SET NULL,
    verdict VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zone_scan_log_zone_created ON zone_scan_log(zone_id, created_at);
CREATE INDEX IF NOT EXISTS idx_batch_checkin_log_event ON batch_checkin_log(event_id);
```

- [ ] **Step 2: Verify the migration applies cleanly against a real local Postgres**

```bash
cd /Users/thevladbog/PRSOME/idento
docker compose up -d db
sleep 3
export DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable"
cd backend && go run ./cmd/migrate
```
Expected: no error, process exits 0 (migrations 000001-000013 all apply; 000013 is new, the rest were likely already applied from a prior run — that's fine, `RunMigrations` skips already-applied versions by row in `schema_migrations`).

- [ ] **Step 3: Confirm the schema shape with psql**

```bash
PGPASSWORD=idento_password psql -h localhost -p 5438 -U idento -d idento_db -c "\d zone_access_rules" -c "\d stations" -c "\d station_provisioning_tokens" -c "\d checkin_overrides" -c "\d batch_checkin_log" -c "\d zone_scan_log"
```
Expected: `zone_access_rules` now lists `time_from` and `time_to` (`character varying(5)`); the five new tables exist with the columns above.

- [ ] **Step 4: Re-run migrate to confirm idempotency**

```bash
cd backend && go run ./cmd/migrate
```
Expected: exits 0 with no errors (the `schema_migrations` row for `000013` already exists, so `RunMigrations` skips re-executing the file — confirms the migration mechanism, not that the SQL itself is re-run twice; this just proves the app boots cleanly against the now-migrated DB).

- [ ] **Step 5: Add the new Go structs to `backend/internal/models/models.go`**

Append at the end of the file:

```go
// Station represents a provisioned mobile check-in/zone-control/kiosk device.
type Station struct {
	ID           uuid.UUID              `json:"id"`
	EventID      uuid.UUID              `json:"event_id"`
	DeviceNumber int                    `json:"device_number"`
	StaffUserID  uuid.UUID              `json:"staff_user_id"`
	DeviceInfo   map[string]interface{} `json:"device_info,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
}

// StationProvisioningToken is a one-time, short-lived token a manager generates
// (shown as a QR in the web console) to bind a new station to a specific staff user.
type StationProvisioningToken struct {
	Token       string     `json:"-"`
	EventID     uuid.UUID  `json:"event_id"`
	StaffUserID uuid.UUID  `json:"staff_user_id"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	ExpiresAt   time.Time  `json:"expires_at"`
	ConsumedAt  *time.Time `json:"consumed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CreateProvisioningTokenRequest struct {
	StaffUserID uuid.UUID `json:"staff_user_id"`
}

type CreateProvisioningTokenResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ProvisionStationRequest struct {
	Token      string                 `json:"token"`
	DeviceInfo map[string]interface{} `json:"device_info,omitempty"`
}

type ProvisionedStationConfig struct {
	EventID   uuid.UUID `json:"event_id"`
	EventName string    `json:"event_name"`
	StaffName string    `json:"staff_name"`
}

type ProvisionStationResponse struct {
	StationConfig ProvisionedStationConfig `json:"station_config"`
	StaffJWT      string                   `json:"staff_jwt"`
	DeviceNumber  int                      `json:"device_number"`
}

// ZoneScanRequest is the body of POST /api/zones/:zone_id/scan.
type ZoneScanRequest struct {
	Code string `json:"code"`
}

type RegistrationInfo struct {
	Passed bool       `json:"passed"`
	At     *time.Time `json:"at,omitempty"`
	Point  string     `json:"point,omitempty"`
}

// ZoneScanResponse is always HTTP 200 for the three designed verdicts (allowed,
// no_access, not_registered) — they are valid business outcomes the mobile UI
// renders as distinct screens, not error states.
type ZoneScanResponse struct {
	Verdict      string            `json:"verdict"`
	Reason       string            `json:"reason,omitempty"`
	Attendee     *Attendee         `json:"attendee,omitempty"`
	Registration *RegistrationInfo `json:"registration,omitempty"`
	CheckedInAt  *time.Time        `json:"checked_in_at,omitempty"`
	FirstEntry   bool              `json:"first_entry"`
}

// CheckinOverride is the audit-logged staff override ("Всё равно пропустить").
type CheckinOverride struct {
	ID          uuid.UUID  `json:"id"`
	AttendeeID  uuid.UUID  `json:"attendee_id"`
	ZoneID      *uuid.UUID `json:"zone_id,omitempty"`
	Context     string     `json:"context"`
	StaffUserID uuid.UUID  `json:"staff_user_id"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CreateCheckinOverrideRequest struct {
	AttendeeID uuid.UUID  `json:"attendee_id"`
	Context    string     `json:"context"`
	ZoneID     *uuid.UUID `json:"zone_id,omitempty"`
}

// BatchCheckinItem is one entry of the offline-sync batch submitted by a mobile
// client; ClientUUID is the idempotency key for retried submissions.
type BatchCheckinItem struct {
	ClientUUID   uuid.UUID  `json:"client_uuid"`
	AttendeeID   uuid.UUID  `json:"attendee_id"`
	At           time.Time  `json:"at"`
	DeviceNumber int        `json:"device_number"`
	Kind         string     `json:"kind"` // "checkin" | "zone_entry"
	ZoneID       *uuid.UUID `json:"zone_id,omitempty"`
}

type BatchCheckinResult struct {
	ClientUUID uuid.UUID `json:"client_uuid"`
	Status     string    `json:"status"` // "created" | "already_exists" | "error"
	Error      string    `json:"error,omitempty"`
}

type ZoneScanStats struct {
	Allowed       int `json:"allowed"`
	NoAccess      int `json:"no_access"`
	NotRegistered int `json:"not_registered"`
}

type EventStatsResponse struct {
	TotalAttendees int            `json:"total_attendees"`
	CheckedIn      int            `json:"checked_in"`
	ZoneStats      *ZoneScanStats `json:"zone_stats,omitempty"`
}
```

- [ ] **Step 6: Extend `ZoneAccessRule` with the new time-window fields**

In `backend/internal/models/models.go`, find:
```go
type ZoneAccessRule struct {
	ID        uuid.UUID `json:"id"`
	ZoneID    uuid.UUID `json:"zone_id"`
	Category  string    `json:"category"`
	Allowed   bool      `json:"allowed"`
	CreatedAt time.Time `json:"created_at"`
}
```
Replace with:
```go
type ZoneAccessRule struct {
	ID        uuid.UUID `json:"id"`
	ZoneID    uuid.UUID `json:"zone_id"`
	Category  string    `json:"category"`
	Allowed   bool      `json:"allowed"`
	TimeFrom  *string   `json:"time_from,omitempty"` // "HH:MM", inclusive lower bound; nil = no lower bound
	TimeTo    *string   `json:"time_to,omitempty"`   // "HH:MM", inclusive upper bound; nil = no upper bound
	CreatedAt time.Time `json:"created_at"`
}
```

- [ ] **Step 7: Build and commit**

```bash
cd backend && go build ./... && go vet ./...
```
Expected: no errors (nothing references the new structs yet, so this only validates syntax).

```bash
git add backend/migrations/000013_mobile_stations.up.sql backend/internal/models/models.go
git commit -m "feat(backend): add Phase B schema — stations, provisioning, overrides, batch/scan logs"
```

---

### Task 2: Time-windowed zone access — `CheckZoneAccessAt` + `evaluateZoneAccessRules`

**Files:**
- Modify: `backend/internal/store/interface.go` (add method signature)
- Modify: `backend/internal/store/pg_store_zones.go` (extend 3 existing methods' SQL; add `evaluateZoneAccessRules` + `CheckZoneAccessAt` + `CreateZoneScanLog`)
- Test: `backend/internal/store/pg_store_zones_test.go` (new file — pure-function test, no DB)

**Interfaces:**
- Consumes: `models.ZoneAccessRule` (Task 1), `s.GetAttendeeByID`, `s.GetZoneAccessRules`, `s.GetAttendeeZoneAccess` (all pre-existing).
- Produces: `Store.CheckZoneAccessAt(ctx, attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error)` and `Store.CreateZoneScanLog(ctx, zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error`, consumed by Task 3's handler.

- [ ] **Step 1: Write the failing test for the pure rule-evaluation function**

Create `backend/internal/store/pg_store_zones_test.go`:
```go
package store

import (
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

func strPtr(s string) *string { return &s }

func TestEvaluateZoneAccessRules_NoRulesDefaultAllow(t *testing.T) {
	allowed, _ := evaluateZoneAccessRules("VIP", nil, time.Now())
	if !allowed {
		t.Fatal("expected default allow when zone has no access rules")
	}
}

func TestEvaluateZoneAccessRules_NoCategoryDeniedWhenRulesExist(t *testing.T) {
	rules := []*models.ZoneAccessRule{{ID: uuid.New(), Category: "VIP", Allowed: true}}
	allowed, reason := evaluateZoneAccessRules("", rules, time.Now())
	if allowed {
		t.Fatalf("expected deny for attendee with no category when rules exist, got allowed (reason=%q)", reason)
	}
}

func TestEvaluateZoneAccessRules_CategoryNotInRulesDenied(t *testing.T) {
	rules := []*models.ZoneAccessRule{{ID: uuid.New(), Category: "VIP", Allowed: true}}
	allowed, _ := evaluateZoneAccessRules("Участник", rules, time.Now())
	if allowed {
		t.Fatal("expected deny for a category with no matching rule")
	}
}

func TestEvaluateZoneAccessRules_TimeWindowDeniesAfterCutoff(t *testing.T) {
	// "Участник" allowed only until 14:00.
	rules := []*models.ZoneAccessRule{
		{ID: uuid.New(), Category: "Участник", Allowed: true, TimeTo: strPtr("14:00")},
		{ID: uuid.New(), Category: "VIP", Allowed: true},
	}
	at := time.Date(2026, 7, 10, 15, 0, 0, 0, time.UTC) // 15:00, after cutoff
	allowed, reason := evaluateZoneAccessRules("Участник", rules, at)
	if allowed {
		t.Fatalf("expected deny after 14:00 cutoff, got allowed (reason=%q)", reason)
	}

	allowedVIP, _ := evaluateZoneAccessRules("VIP", rules, at)
	if !allowedVIP {
		t.Fatal("expected VIP (no time bound) to always be allowed")
	}
}

func TestEvaluateZoneAccessRules_TimeWindowAllowsBeforeCutoff(t *testing.T) {
	rules := []*models.ZoneAccessRule{
		{ID: uuid.New(), Category: "Участник", Allowed: true, TimeTo: strPtr("14:00")},
	}
	at := time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) // 10:00, before cutoff
	allowed, _ := evaluateZoneAccessRules("Участник", rules, at)
	if !allowed {
		t.Fatal("expected allow before the 14:00 cutoff")
	}
}

func TestEvaluateZoneAccessRules_ExplicitlyDeniedCategory(t *testing.T) {
	rules := []*models.ZoneAccessRule{{ID: uuid.New(), Category: "Подрядчик", Allowed: false}}
	allowed, _ := evaluateZoneAccessRules("Подрядчик", rules, time.Now())
	if allowed {
		t.Fatal("expected deny for a category rule with allowed=false")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && go test ./internal/store/... -run TestEvaluateZoneAccessRules -v
```
Expected: FAIL — `evaluateZoneAccessRules` undefined.

- [ ] **Step 3: Extend the `ZoneAccessRule` store methods to carry `time_from`/`time_to`**

In `backend/internal/store/pg_store_zones.go`, replace `CreateZoneAccessRule` (currently lines 191-206):
```go
func (s *PGStore) CreateZoneAccessRule(ctx context.Context, rule *models.ZoneAccessRule) error {
	rule.ID = uuid.New()
	rule.CreatedAt = time.Now()

	query := `
		INSERT INTO zone_access_rules (id, zone_id, category, allowed, time_from, time_to, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (zone_id, category) DO UPDATE SET allowed = EXCLUDED.allowed, time_from = EXCLUDED.time_from, time_to = EXCLUDED.time_to
	`

	_, err := s.db.Exec(ctx, query,
		rule.ID, rule.ZoneID, rule.Category, rule.Allowed, rule.TimeFrom, rule.TimeTo, rule.CreatedAt,
	)

	return err
}
```

Replace `GetZoneAccessRules` (currently lines 209-235):
```go
func (s *PGStore) GetZoneAccessRules(ctx context.Context, zoneID uuid.UUID) ([]*models.ZoneAccessRule, error) {
	query := `
		SELECT id, zone_id, category, allowed, time_from, time_to, created_at
		FROM zone_access_rules
		WHERE zone_id = $1
		ORDER BY category ASC
	`

	rows, err := s.db.Query(ctx, query, zoneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.ZoneAccessRule
	for rows.Next() {
		var rule models.ZoneAccessRule
		err := rows.Scan(
			&rule.ID, &rule.ZoneID, &rule.Category,
			&rule.Allowed, &rule.TimeFrom, &rule.TimeTo, &rule.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		rules = append(rules, &rule)
	}

	return rules, rows.Err()
}
```

In `BulkUpdateZoneAccessRules`, replace the insert query (currently the `tx.Exec` inside the `for _, rule := range rules` loop):
```go
		_, err = tx.Exec(ctx,
			`INSERT INTO zone_access_rules (id, zone_id, category, allowed, time_from, time_to, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			rule.ID, rule.ZoneID, rule.Category, rule.Allowed, rule.TimeFrom, rule.TimeTo, rule.CreatedAt,
		)
```

- [ ] **Step 4: Add `evaluateZoneAccessRules`, `CheckZoneAccessAt`, `CreateZoneScanLog`**

Append to `backend/internal/store/pg_store_zones.go` (after `CheckZoneAccess`):
```go
// evaluateZoneAccessRules decides admission for one attendee category against the
// zone's rules at a point in time. Pure and unexported for direct unit testing.
// Semantics: no rules at all → allow (default); rules exist but attendee has no
// category → deny; a category with no matching rule → deny; a matching rule's
// time window (time_from/time_to, "HH:MM", either bound optional) is checked
// before its Allowed flag.
func evaluateZoneAccessRules(category string, rules []*models.ZoneAccessRule, at time.Time) (bool, string) {
	if len(rules) == 0 {
		return true, "Access granted (default)"
	}
	if category == "" {
		return false, "Attendee has no category assigned"
	}

	var categoryRule *models.ZoneAccessRule
	for _, rule := range rules {
		if rule.Category == category {
			categoryRule = rule
			break
		}
	}
	if categoryRule == nil {
		return false, fmt.Sprintf("Category not authorized for this zone: %s", category)
	}

	nowStr := at.Format("15:04")
	if categoryRule.TimeFrom != nil && nowStr < *categoryRule.TimeFrom {
		return false, fmt.Sprintf("Category not authorized before %s: %s", *categoryRule.TimeFrom, category)
	}
	if categoryRule.TimeTo != nil && nowStr > *categoryRule.TimeTo {
		return false, fmt.Sprintf("Category not authorized after %s: %s", *categoryRule.TimeTo, category)
	}
	if !categoryRule.Allowed {
		return false, fmt.Sprintf("Access denied for category: %s", category)
	}
	return true, "Access granted by category"
}

// CheckZoneAccessAt is the time-aware counterpart of CheckZoneAccess, used by the
// new mobile zone-control scan endpoint. It intentionally denies when the
// attendee has no category and zone rules exist (CheckZoneAccess instead
// defaults to allow in that case) — a deliberate tightening for this new,
// stricter zone-control surface; CheckZoneAccess itself is untouched.
func (s *PGStore) CheckZoneAccessAt(ctx context.Context, attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error) {
	attendee, err := s.GetAttendeeByID(ctx, attendeeID)
	if err != nil {
		return false, "Attendee not found", err
	}
	if attendee.Blocked {
		return false, "Attendee is blocked", nil
	}

	override, err := s.GetAttendeeZoneAccess(ctx, attendeeID, zoneID)
	if err == nil && override != nil {
		if !override.Allowed {
			return false, "Access denied (individual override)", nil
		}
		return true, "Access granted (individual override)", nil
	}

	category, _ := attendee.CustomFields["category"].(string)
	rules, err := s.GetZoneAccessRules(ctx, zoneID)
	if err != nil {
		return false, "Failed to load access rules", err
	}

	allowed, reason := evaluateZoneAccessRules(category, rules, at)
	return allowed, reason, nil
}

// CreateZoneScanLog records one mobile zone-scan outcome, feeding GetEventStats.
func (s *PGStore) CreateZoneScanLog(ctx context.Context, zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO zone_scan_log (id, zone_id, attendee_id, verdict, created_at) VALUES ($1, $2, $3, $4, $5)`,
		uuid.New(), zoneID, attendeeID, verdict, time.Now(),
	)
	return err
}
```

Confirm `fmt` is already imported in this file (it is, used elsewhere in `CheckZoneAccess`).

- [ ] **Step 5: Add the new methods to the `Store` interface**

In `backend/internal/store/interface.go`, add near the existing zone-access-rule methods (after `BulkUpdateZoneAccessRules(...)`):
```go
	CheckZoneAccessAt(ctx context.Context, attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error)
	CreateZoneScanLog(ctx context.Context, zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd backend && go test ./internal/store/... -run TestEvaluateZoneAccessRules -v
```
Expected: all 6 subtests PASS.

- [ ] **Step 7: Full build + test + commit**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
```
Expected: all packages pass (this also proves `pg_store.go`'s `PGStore` still satisfies `store.Store` with the two new interface methods).

```bash
git add backend/internal/store/interface.go backend/internal/store/pg_store_zones.go backend/internal/store/pg_store_zones_test.go
git commit -m "feat(backend): time-windowed zone access rules + CheckZoneAccessAt"
```

---

### Task 3: Mobile zone-control scan endpoint — `POST /api/zones/:zone_id/scan`

**Files:**
- Create: `backend/internal/handler/zone_scan.go`
- Modify: `backend/internal/handler/handler.go` (register route)
- Modify: `backend/internal/handler/testsupport_test.go` (extend `fakeStore`)
- Test: `backend/internal/handler/zone_scan_test.go`

**Interfaces:**
- Consumes: `h.requireZoneOwnership` (existing), `h.Store.GetZoneStaffAssignments`, `h.Store.GetAttendeeByCode`, `h.Store.CheckZoneAccessAt`, `h.Store.CreateZoneScanLog`, `h.Store.CheckAttendeeZoneCheckin`, `h.Store.CreateZoneCheckin`, `h.Store.GetEventZoneByID` (all existing or Task 2).
- Produces: `Handler.ZoneScan(c echo.Context) error`, registered as `POST /api/zones/:zone_id/scan`. Response `models.ZoneScanResponse` (Task 1) is consumed by the mobile client in Phase M2.

- [ ] **Step 1: Extend `fakeStore` with the methods this handler needs**

In `backend/internal/handler/testsupport_test.go`, add fields to the `fakeStore` struct (inside the existing `struct { ... }` block, e.g. right after `getZoneStaffAssign`):
```go
	checkZoneAccessAt      func(attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error)
	createZoneScanLog      func(zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error
	checkAttendeeZoneCheckin func(attendeeID, zoneID uuid.UUID, date time.Time) (*models.ZoneCheckin, error)
	createZoneCheckin      func(checkin *models.ZoneCheckin) error
```
Add the wrapper methods (anywhere after the struct, alongside the other `func (f *fakeStore) ...` wrappers):
```go
func (f *fakeStore) CheckZoneAccessAt(_ context.Context, attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error) {
	return f.checkZoneAccessAt(attendeeID, zoneID, at)
}
func (f *fakeStore) CreateZoneScanLog(_ context.Context, zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error {
	return f.createZoneScanLog(zoneID, attendeeID, verdict)
}
func (f *fakeStore) CheckAttendeeZoneCheckin(_ context.Context, attendeeID, zoneID uuid.UUID, date time.Time) (*models.ZoneCheckin, error) {
	return f.checkAttendeeZoneCheckin(attendeeID, zoneID, date)
}
func (f *fakeStore) CreateZoneCheckin(_ context.Context, checkin *models.ZoneCheckin) error {
	return f.createZoneCheckin(checkin)
}
```

- [ ] **Step 2: Write the failing tests**

Create `backend/internal/handler/zone_scan_test.go`:
```go
package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestZoneScan_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/"+zoneID.String()+"/scan", `{"code":"ABCD1234"}`, caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())
	_ = h.ZoneScan(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign-tenant zone, got %d", rec.Code)
	}
}

func TestZoneScan_AllowedVerdictRecordsEntryAndScanLog(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	zoneID := uuid.New()
	attendeeID := uuid.New()
	registeredAt := time.Now().Add(-time.Hour)

	var scanLogVerdict string
	var checkinCreated bool

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true, RequiresRegistration: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByCode: func(_ uuid.UUID, _ string) (*models.Attendee, error) {
			return &models.Attendee{ID: attendeeID, EventID: eventID, RegisteredAt: &registeredAt}, nil
		},
		checkZoneAccessAt: func(_, _ uuid.UUID, _ time.Time) (bool, string, error) {
			return true, "Access granted by category", nil
		},
		checkAttendeeZoneCheckin: func(_, _ uuid.UUID, _ time.Time) (*models.ZoneCheckin, error) {
			return nil, nil // first entry today
		},
		createZoneCheckin: func(_ *models.ZoneCheckin) error {
			checkinCreated = true
			return nil
		},
		createZoneScanLog: func(_ uuid.UUID, _ *uuid.UUID, verdict string) error {
			scanLogVerdict = verdict
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/"+zoneID.String()+"/scan", `{"code":"ABCD1234"}`, tenantID.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())
	if err := h.ZoneScan(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !checkinCreated {
		t.Fatal("expected a zone checkin to be recorded for an allowed verdict")
	}
	if scanLogVerdict != "allowed" {
		t.Fatalf("expected scan log verdict 'allowed', got %q", scanLogVerdict)
	}
}

func TestZoneScan_NotRegisteredVerdict(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	zoneID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true, RequiresRegistration: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByCode: func(_ uuid.UUID, _ string) (*models.Attendee, error) {
			return &models.Attendee{ID: attendeeID, EventID: eventID, RegisteredAt: nil}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/"+zoneID.String()+"/scan", `{"code":"ABCD1234"}`, tenantID.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())
	if err := h.ZoneScan(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (verdict is not an HTTP error), got %d", rec.Code)
	}
	var resp models.ZoneScanResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Verdict != "not_registered" {
		t.Fatalf("expected verdict 'not_registered', got %q", resp.Verdict)
	}
}
```

Add the small decode helper this test uses (it doesn't exist yet) to `backend/internal/handler/testsupport_test.go`, right after `newAuthedContextWithUserID`:
```go
// jsonUnmarshalBody decodes a recorded response body into v.
func jsonUnmarshalBody(rec *httptest.ResponseRecorder, v interface{}) error {
	return json.Unmarshal(rec.Body.Bytes(), v)
}
```
Add `"encoding/json"` to that file's import block if not already present (it is not, per the file read in this plan's research).

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend && go test ./internal/handler/... -run TestZoneScan -v
```
Expected: FAIL — `h.ZoneScan` undefined.

- [ ] **Step 4: Implement the handler**

Create `backend/internal/handler/zone_scan.go`:
```go
package handler

import (
	"net/http"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// ZoneScan computes a mobile zone-control verdict (allowed | no_access |
// not_registered) for a scanned attendee code. Unlike the legacy
// POST /api/zones/checkin, this always returns HTTP 200 with a structured
// verdict — all three outcomes are valid business results the mobile UI
// renders as distinct screens, not error states. On an "allowed" verdict it
// records a zone_checkins row exactly like the legacy handler (same
// idempotency check), and logs every outcome to zone_scan_log for stats.
func (h *Handler) ZoneScan(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}
	zone, event, err := h.requireZoneOwnership(c, zoneID)
	if err != nil {
		return writeErr(c, err)
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	callerID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}
	if claims.Role != "admin" && claims.Role != "manager" {
		assignments, err := h.Store.GetZoneStaffAssignments(c.Request().Context(), zoneID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify zone assignment"})
		}
		assigned := false
		for _, a := range assignments {
			if a.UserID == callerID {
				assigned = true
				break
			}
		}
		if !assigned {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "Not assigned to this zone"})
		}
	}

	var req models.ZoneScanRequest
	if err := c.Bind(&req); err != nil || req.Code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	attendee, err := h.Store.GetAttendeeByCode(c.Request().Context(), event.ID, req.Code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to look up attendee"})
	}
	if attendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	now := time.Now()
	regInfo := &models.RegistrationInfo{Passed: attendee.RegisteredAt != nil, At: attendee.RegisteredAt}
	if attendee.RegistrationZoneID != nil {
		if regZone, err := h.Store.GetEventZoneByID(c.Request().Context(), *attendee.RegistrationZoneID); err == nil && regZone != nil {
			regInfo.Point = regZone.Name
		}
	}

	if !zone.IsActive || !isWithinZoneTime(zone, now) {
		_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "no_access")
		return c.JSON(http.StatusOK, models.ZoneScanResponse{
			Verdict:      "no_access",
			Reason:       "Zone is closed",
			Attendee:     attendee,
			Registration: regInfo,
		})
	}

	if zone.RequiresRegistration && attendee.RegisteredAt == nil {
		_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "not_registered")
		return c.JSON(http.StatusOK, models.ZoneScanResponse{
			Verdict:      "not_registered",
			Reason:       "Attendee has not registered yet",
			Attendee:     attendee,
			Registration: regInfo,
		})
	}

	allowed, reason, err := h.Store.CheckZoneAccessAt(c.Request().Context(), attendee.ID, zoneID, now)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to evaluate zone access"})
	}
	if !allowed {
		_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "no_access")
		return c.JSON(http.StatusOK, models.ZoneScanResponse{
			Verdict:      "no_access",
			Reason:       reason,
			Attendee:     attendee,
			Registration: regInfo,
		})
	}

	existing, err := h.Store.CheckAttendeeZoneCheckin(c.Request().Context(), attendee.ID, zoneID, now)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check idempotency"})
	}
	firstEntry := existing == nil
	if firstEntry {
		if err := h.Store.CreateZoneCheckin(c.Request().Context(), &models.ZoneCheckin{
			AttendeeID:  attendee.ID,
			ZoneID:      zoneID,
			CheckedInBy: &callerID,
			EventDay:    now,
			Metadata:    map[string]interface{}{"source": "mobile_scan"},
		}); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to record zone entry"})
		}
	}
	_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "allowed")

	return c.JSON(http.StatusOK, models.ZoneScanResponse{
		Verdict:      "allowed",
		Reason:       reason,
		Attendee:     attendee,
		Registration: regInfo,
		CheckedInAt:  &now,
		FirstEntry:   firstEntry,
	})
}
```

- [ ] **Step 5: Register the route**

In `backend/internal/handler/handler.go`, add under the existing `// Zone Check-in` section (after `api.GET("/attendees/:attendee_id/zone-history", h.GetAttendeeZoneHistory)`):
```go
	// Mobile zone-control scan (structured verdict, no rate limit — legitimate high-frequency op)
	api.POST("/zones/:zone_id/scan", h.ZoneScan)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && go test ./internal/handler/... -run TestZoneScan -v
```
Expected: all 3 tests PASS.

- [ ] **Step 7: Full test suite + commit**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
git add backend/internal/handler/zone_scan.go backend/internal/handler/handler.go backend/internal/handler/zone_scan_test.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): POST /api/zones/:zone_id/scan — mobile zone-control verdict endpoint"
```

---

### Task 4: Station provisioning — generate token + redeem (mint device JWT)

**Files:**
- Create: `backend/internal/store/pg_store_stations.go`
- Create: `backend/internal/handler/stations.go`
- Modify: `backend/internal/store/interface.go`
- Modify: `backend/internal/handler/handler.go` (register 2 routes)
- Modify: `backend/internal/handler/testsupport_test.go` (extend `fakeStore`)
- Test: `backend/internal/handler/stations_test.go`

**Interfaces:**
- Consumes: `models.Station`, `models.StationProvisioningToken`, `models.CreateProvisioningTokenRequest/Response`, `models.ProvisionStationRequest/Response`, `models.ProvisionedStationConfig` (Task 1); `generateTokenForTenant` (existing, `backend/internal/handler/auth.go:192`, same package).
- Produces: `Store.CreateProvisioningToken`, `Store.ConsumeProvisioningToken`, `Store.CreateStation`; `Handler.CreateStationProvisioningToken` → `POST /api/events/:event_id/stations/provisioning-token`; `Handler.ProvisionStation` → `POST /api/stations/provision` (public). The Web task (Task 8) calls the first; the mobile client (Phase M1) calls the second.

- [ ] **Step 1: Add store interface methods**

In `backend/internal/store/interface.go`, add near the other zone/station-adjacent methods:
```go
	CreateProvisioningToken(ctx context.Context, tok *models.StationProvisioningToken) error
	ConsumeProvisioningToken(ctx context.Context, token string) (*models.StationProvisioningToken, error)
	CreateStation(ctx context.Context, eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error)
```

- [ ] **Step 2: Implement the store methods**

Create `backend/internal/store/pg_store_stations.go`:
```go
package store

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CreateProvisioningToken persists a one-time station-provisioning token.
func (s *PGStore) CreateProvisioningToken(ctx context.Context, tok *models.StationProvisioningToken) error {
	tok.CreatedAt = time.Now()
	query := `INSERT INTO station_provisioning_tokens (token, event_id, staff_user_id, created_by, expires_at, created_at)
			  VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := s.db.Exec(ctx, query, tok.Token, tok.EventID, tok.StaffUserID, tok.CreatedBy, tok.ExpiresAt, tok.CreatedAt)
	return err
}

// ConsumeProvisioningToken atomically marks a token consumed and returns it, or
// (nil, nil) if it doesn't exist, is already consumed, or has expired — the
// UPDATE's WHERE clause makes this check-and-consume atomic under concurrent
// redemption attempts of the same token.
func (s *PGStore) ConsumeProvisioningToken(ctx context.Context, token string) (*models.StationProvisioningToken, error) {
	query := `
		UPDATE station_provisioning_tokens
		SET consumed_at = NOW()
		WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW()
		RETURNING token, event_id, staff_user_id, created_by, expires_at, consumed_at, created_at
	`
	row := s.db.QueryRow(ctx, query, token)
	var t models.StationProvisioningToken
	err := row.Scan(&t.Token, &t.EventID, &t.StaffUserID, &t.CreatedBy, &t.ExpiresAt, &t.ConsumedAt, &t.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateStation assigns the next device_number for the event (serialized by
// locking the event row for the duration of the transaction) and inserts the
// station row.
func (s *PGStore) CreateStation(ctx context.Context, eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && rbErr != pgx.ErrTxClosed {
			log.Printf("Failed to rollback transaction: %v", rbErr)
		}
	}()

	if _, err := tx.Exec(ctx, `SELECT id FROM events WHERE id = $1 FOR UPDATE`, eventID); err != nil {
		return nil, err
	}

	var nextNumber int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(device_number), 0) + 1 FROM stations WHERE event_id = $1`,
		eventID,
	).Scan(&nextNumber); err != nil {
		return nil, err
	}

	deviceInfoJSON, err := json.Marshal(deviceInfo)
	if err != nil {
		return nil, err
	}

	station := &models.Station{
		ID:           uuid.New(),
		EventID:      eventID,
		DeviceNumber: nextNumber,
		StaffUserID:  staffUserID,
		DeviceInfo:   deviceInfo,
		CreatedAt:    time.Now(),
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO stations (id, event_id, device_number, staff_user_id, device_info, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		station.ID, station.EventID, station.DeviceNumber, station.StaffUserID, deviceInfoJSON, station.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return station, nil
}
```

- [ ] **Step 3: Extend `fakeStore`**

In `backend/internal/handler/testsupport_test.go`, add struct fields:
```go
	createProvisioningToken  func(tok *models.StationProvisioningToken) error
	consumeProvisioningToken func(token string) (*models.StationProvisioningToken, error)
	createStation            func(eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error)
```
Add wrapper methods:
```go
func (f *fakeStore) CreateProvisioningToken(_ context.Context, tok *models.StationProvisioningToken) error {
	return f.createProvisioningToken(tok)
}
func (f *fakeStore) ConsumeProvisioningToken(_ context.Context, token string) (*models.StationProvisioningToken, error) {
	return f.consumeProvisioningToken(token)
}
func (f *fakeStore) CreateStation(_ context.Context, eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error) {
	return f.createStation(eventID, staffUserID, deviceInfo)
}
```

- [ ] **Step 4: Write the failing handler tests**

Create `backend/internal/handler/stations_test.go`:
```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestCreateStationProvisioningToken_RequiresManagerRole(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/stations/provisioning-token", `{"staff_user_id":"`+uuid.New().String()+`"}`, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateStationProvisioningToken(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-manager role, got %d", rec.Code)
	}
}

func TestCreateStationProvisioningToken_ForeignTenantStaffUser404(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	staffID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: id}, nil
		},
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) {
			return "", nil // not a member of this tenant
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/stations/provisioning-token", `{"staff_user_id":"`+staffID.String()+`"}`, tenantID.String(), "manager")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateStationProvisioningToken(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for staff user outside caller's tenant, got %d", rec.Code)
	}
}

func TestProvisionStation_InvalidTokenReturns401(t *testing.T) {
	fs := &fakeStore{
		consumeProvisioningToken: func(_ string) (*models.StationProvisioningToken, error) {
			return nil, nil // expired, consumed, or unknown
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/api/stations/provision", `{"token":"bogus"}`)
	if err := h.ProvisionStation(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", rec.Code)
	}
}

func TestProvisionStation_ValidTokenIssuesJWTAndDeviceNumber(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	staffID := uuid.New()
	fs := &fakeStore{
		consumeProvisioningToken: func(_ string) (*models.StationProvisioningToken, error) {
			return &models.StationProvisioningToken{Token: "tok", EventID: eventID, StaffUserID: staffID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID, Name: "Технопром-2026"}, nil
		},
		getUserByID: func(id uuid.UUID) (*models.User, error) {
			return &models.User{ID: id, Email: "staff@idento.app", Role: "staff"}, nil
		},
		createStation: func(_, _ uuid.UUID, _ map[string]interface{}) (*models.Station, error) {
			return &models.Station{ID: uuid.New(), EventID: eventID, DeviceNumber: 3}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/api/stations/provision", `{"token":"tok"}`)
	if err := h.ProvisionStation(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp models.ProvisionStationResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resp.DeviceNumber != 3 || resp.StationConfig.EventName != "Технопром-2026" || resp.StaffJWT == "" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}
```

Add a small unauthenticated-context helper next to `newAuthedContext` in `backend/internal/handler/testsupport_test.go` (this endpoint has no JWT to set):
```go
// newUnauthedContext builds a plain echo.Context with no "user" set, for
// endpoints reached before a device has a JWT (e.g. station provisioning).
func newUnauthedContext(e *echo.Echo, method, path, body string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	return e.NewContext(req, rec), rec
}
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
cd backend && go test ./internal/handler/... -run "TestCreateStationProvisioningToken|TestProvisionStation" -v
```
Expected: FAIL — `h.CreateStationProvisioningToken`, `h.ProvisionStation`, `newUnauthedContext` undefined.

- [ ] **Step 6: Implement the handlers**

Create `backend/internal/handler/stations.go`:
```go
package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CreateStationProvisioningToken lets a manager/admin mint a short-lived (10
// minute), one-time token — shown as a QR in the web console — that binds a new
// mobile station to a specific existing staff user for this event.
func (h *Handler) CreateStationProvisioningToken(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	if claims.Role != "admin" && claims.Role != "manager" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Only admins/managers can provision stations"})
	}
	callerID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}
	tenantID, err := uuid.Parse(claims.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	var req models.CreateProvisioningTokenRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	staffUser, err := h.Store.GetUserByID(c.Request().Context(), req.StaffUserID)
	if err != nil || staffUser == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Staff user not found"})
	}
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), staffUser.ID, tenantID)
	if err != nil || role == "" {
		// Uniform 404: don't reveal that the user exists in another tenant.
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Staff user not found"})
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}
	tok := &models.StationProvisioningToken{
		Token:       hex.EncodeToString(tokenBytes),
		EventID:     eventID,
		StaffUserID: staffUser.ID,
		CreatedBy:   callerID,
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	}
	if err := h.Store.CreateProvisioningToken(c.Request().Context(), tok); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create provisioning token"})
	}

	return c.JSON(http.StatusCreated, models.CreateProvisioningTokenResponse{
		Token:     tok.Token,
		ExpiresAt: tok.ExpiresAt,
	})
}

// ProvisionStation redeems a one-time provisioning token — PUBLIC, unauthenticated,
// since the mobile device has no JWT yet — and mints one for the token's bound
// staff user, plus a per-event device number.
func (h *Handler) ProvisionStation(c echo.Context) error {
	var req models.ProvisionStationRequest
	if err := c.Bind(&req); err != nil || req.Token == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	tok, err := h.Store.ConsumeProvisioningToken(c.Request().Context(), req.Token)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to redeem token"})
	}
	if tok == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), tok.EventID)
	if err != nil || event == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load event"})
	}
	staffUser, err := h.Store.GetUserByID(c.Request().Context(), tok.StaffUserID)
	if err != nil || staffUser == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load staff user"})
	}

	station, err := h.Store.CreateStation(c.Request().Context(), tok.EventID, tok.StaffUserID, req.DeviceInfo)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create station"})
	}

	jwtToken, err := generateTokenForTenant(staffUser, event.TenantID.String(), staffUser.Role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue token"})
	}

	return c.JSON(http.StatusOK, models.ProvisionStationResponse{
		StationConfig: models.ProvisionedStationConfig{
			EventID:   event.ID,
			EventName: event.Name,
			StaffName: staffUser.Email,
		},
		StaffJWT:     jwtToken,
		DeviceNumber: station.DeviceNumber,
	})
}
```

- [ ] **Step 7: Register the routes**

In `backend/internal/handler/handler.go`:

Add under `// Events` section (after `api.POST("/events/:event_id/staff", h.AssignStaffToEvent)`):
```go
	api.POST("/events/:event_id/stations/provisioning-token", h.CreateStationProvisioningToken)
```

Add right after the `auth` group block (before `api := e.Group("/api")`), since this is public like `/auth/*`:
```go
	// Station provisioning (public — the device has no JWT yet; rate-limited
	// like login since it's an unauthenticated, token-guessable surface).
	e.POST("/api/stations/provision", h.ProvisionStation, authLimiter)
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd backend && go test ./internal/handler/... -run "TestCreateStationProvisioningToken|TestProvisionStation" -v
```
Expected: all 4 tests PASS.

- [ ] **Step 9: Full test suite + commit**

```bash
cd backend && go build ./... && go vet ./... && go test ./...
git add backend/internal/store/interface.go backend/internal/store/pg_store_stations.go backend/internal/handler/stations.go backend/internal/handler/stations_test.go backend/internal/handler/handler.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): station provisioning — generate token (manager) + redeem (device)"
```

---

### Task 5: Idempotent batch check-in — `POST /api/events/:event_id/checkins/batch`

**Files:**
- Create: `backend/internal/store/pg_store_batch.go`
- Create: `backend/internal/handler/checkins_batch.go`
- Modify: `backend/internal/store/interface.go`
- Modify: `backend/internal/handler/handler.go`
- Modify: `backend/internal/handler/testsupport_test.go`
- Test: `backend/internal/handler/checkins_batch_test.go`

**Interfaces:**
- Consumes: `models.BatchCheckinItem/Result` (Task 1); `s.GetAttendeeByID`, `s.UpdateAttendee`, `s.CheckAttendeeZoneCheckin`, `s.CreateZoneCheckin`, `h.Store.GetEventZoneByID` (all existing).
- Produces: `Store.ApplyBatchCheckin(ctx, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (applied bool, err error)`; `Handler.BatchCheckin` → `POST /api/events/:event_id/checkins/batch`, consumed by the mobile offline-sync client (Phase M1).

- [ ] **Step 1: Add the store interface method**

In `backend/internal/store/interface.go`:
```go
	ApplyBatchCheckin(ctx context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (bool, error)
```

- [ ] **Step 2: Implement the store method**

Create `backend/internal/store/pg_store_batch.go`:
```go
package store

import (
	"context"
	"fmt"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// ApplyBatchCheckin applies one offline-queued item idempotently: if
// item.ClientUUID was already logged, it returns (false, nil) without
// re-applying the write. Otherwise it performs the underlying check-in
// (attendee check-in, or zone entry) and records the dedup log row.
// This is intentionally NOT wrapped in one cross-call transaction — each
// underlying write already has its own uniqueness guarantee (attendee
// check-in is a no-op if already true; zone_checkins has a UNIQUE
// (attendee_id, zone_id, event_day) constraint), and batch_checkin_log's
// PRIMARY KEY on client_uuid means even a true concurrent-retry race can
// only produce one log row, which is what the mobile client's dedup
// depends on.
func (s *PGStore) ApplyBatchCheckin(ctx context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (bool, error) {
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM batch_checkin_log WHERE client_uuid = $1)`,
		item.ClientUUID,
	).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}

	switch item.Kind {
	case "checkin":
		attendee, err := s.GetAttendeeByID(ctx, item.AttendeeID)
		if err != nil {
			return false, err
		}
		if attendee == nil {
			return false, fmt.Errorf("attendee not found")
		}
		if !attendee.CheckinStatus {
			attendee.CheckinStatus = true
			attendee.CheckedInAt = &item.At
			attendee.CheckedInBy = &staffUserID
			if err := s.UpdateAttendee(ctx, attendee); err != nil {
				return false, err
			}
		}
	case "zone_entry":
		if item.ZoneID == nil {
			return false, fmt.Errorf("zone_id is required for kind=zone_entry")
		}
		existing, err := s.CheckAttendeeZoneCheckin(ctx, item.AttendeeID, *item.ZoneID, item.At)
		if err != nil {
			return false, err
		}
		if existing == nil {
			if err := s.CreateZoneCheckin(ctx, &models.ZoneCheckin{
				AttendeeID:  item.AttendeeID,
				ZoneID:      *item.ZoneID,
				CheckedInBy: &staffUserID,
				EventDay:    item.At,
				Metadata:    map[string]interface{}{"device_number": item.DeviceNumber, "source": "batch"},
			}); err != nil {
				return false, err
			}
		}
	default:
		return false, fmt.Errorf("unknown kind: %s", item.Kind)
	}

	_, err := s.db.Exec(ctx,
		`INSERT INTO batch_checkin_log (client_uuid, event_id, attendee_id, kind, zone_id, device_number, checked_in_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (client_uuid) DO NOTHING`,
		item.ClientUUID, eventID, item.AttendeeID, item.Kind, item.ZoneID, item.DeviceNumber, item.At,
	)
	if err != nil {
		return false, err
	}
	return true, nil
}
```

- [ ] **Step 3: Extend `fakeStore`**

Add a field:
```go
	applyBatchCheckin func(eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (bool, error)
```
Add wrapper:
```go
func (f *fakeStore) ApplyBatchCheckin(_ context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (bool, error) {
	return f.applyBatchCheckin(eventID, staffUserID, item)
}
```

- [ ] **Step 4: Write the failing tests**

Create `backend/internal/handler/checkins_batch_test.go`:
```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestBatchCheckin_RejectsAttendeeFromDifferentEvent(t *testing.T) {
	eventID := uuid.New()
	otherEventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	clientUUID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: otherEventID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `[{"client_uuid":"` + clientUUID.String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"}]`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.BatchCheckin(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with per-item errors, got %d", rec.Code)
	}
	var results []models.BatchCheckinResult
	if err := jsonUnmarshalBody(rec, &results); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(results) != 1 || results[0].Status != "error" {
		t.Fatalf("expected one error result for cross-event attendee, got %+v", results)
	}
}

func TestBatchCheckin_DedupsRepeatedClientUUID(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	clientUUID := uuid.New()
	callCount := 0
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		applyBatchCheckin: func(_, _ uuid.UUID, _ *models.BatchCheckinItem) (bool, error) {
			callCount++
			return callCount == 1, nil // first call applies, replay reports duplicate
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `[{"client_uuid":"` + clientUUID.String() + `","attendee_id":"` + attendeeID.String() + `","at":"2026-07-10T10:00:00Z","device_number":1,"kind":"checkin"}]`

	c1, rec1 := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c1.SetParamNames("event_id")
	c1.SetParamValues(eventID.String())
	_ = h.BatchCheckin(c1)
	var r1 []models.BatchCheckinResult
	_ = jsonUnmarshalBody(rec1, &r1)
	if r1[0].Status != "created" {
		t.Fatalf("expected first submission 'created', got %q", r1[0].Status)
	}

	c2, rec2 := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/batch", body, tenantID.String(), "staff")
	c2.SetParamNames("event_id")
	c2.SetParamValues(eventID.String())
	_ = h.BatchCheckin(c2)
	var r2 []models.BatchCheckinResult
	_ = jsonUnmarshalBody(rec2, &r2)
	if r2[0].Status != "already_exists" {
		t.Fatalf("expected retried submission 'already_exists', got %q", r2[0].Status)
	}
}
```

- [ ] **Step 5: Run to verify failure**

```bash
cd backend && go test ./internal/handler/... -run TestBatchCheckin -v
```
Expected: FAIL — `h.BatchCheckin` undefined.

- [ ] **Step 6: Implement the handler**

Create `backend/internal/handler/checkins_batch.go`:
```go
package handler

import (
	"net/http"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// BatchCheckin applies a batch of offline-queued check-ins/zone-entries
// idempotently (deduplicated by client_uuid), for mobile clients flushing
// their offline sync queue. Always returns 200 with a per-item result array —
// a single bad item does not fail the whole batch.
func (h *Handler) BatchCheckin(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var items []models.BatchCheckinItem
	if err := c.Bind(&items); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if len(items) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Empty batch"})
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	staffUserID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	results := make([]models.BatchCheckinResult, 0, len(items))
	for i := range items {
		item := items[i]

		attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), item.AttendeeID)
		if err != nil || attendee == nil || attendee.EventID != eventID {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "Attendee not found in event"})
			continue
		}

		if item.Kind == "zone_entry" {
			if item.ZoneID == nil {
				results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "zone_id is required for kind=zone_entry"})
				continue
			}
			zone, err := h.Store.GetEventZoneByID(c.Request().Context(), *item.ZoneID)
			if err != nil || zone == nil || zone.EventID != eventID {
				results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "Zone not found in event"})
				continue
			}
		} else if item.Kind != "checkin" {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "Unknown kind"})
			continue
		}

		applied, err := h.Store.ApplyBatchCheckin(c.Request().Context(), eventID, staffUserID, &item)
		if err != nil {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: err.Error()})
			continue
		}
		if applied {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "created"})
		} else {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "already_exists"})
		}
	}
	return c.JSON(http.StatusOK, results)
}
```

- [ ] **Step 7: Register the route**

In `backend/internal/handler/handler.go`, add a new section after `// Zone Check-in`:
```go
	// Mobile offline-sync batch check-in (idempotent by client_uuid)
	api.POST("/events/:event_id/checkins/batch", h.BatchCheckin)
```

- [ ] **Step 8: Run tests to verify pass, then full suite + commit**

```bash
cd backend && go test ./internal/handler/... -run TestBatchCheckin -v
cd backend && go build ./... && go vet ./... && go test ./...
git add backend/internal/store/interface.go backend/internal/store/pg_store_batch.go backend/internal/handler/checkins_batch.go backend/internal/handler/checkins_batch_test.go backend/internal/handler/handler.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): idempotent batch check-in — POST /api/events/:event_id/checkins/batch"
```

---

### Task 6: Check-in override audit log — `POST /api/events/:event_id/checkins/override`

**Files:**
- Create: `backend/internal/handler/checkins_override.go`
- Modify: `backend/internal/store/interface.go`, `backend/internal/store/pg_store_zones.go` (add `CreateCheckinOverride` near the other zone-adjacent methods, or a new small file — using `pg_store_batch.go`'s sibling file is fine too; this plan puts it in a dedicated file for clarity)
- Create: `backend/internal/store/pg_store_overrides.go`
- Modify: `backend/internal/handler/handler.go`, `backend/internal/handler/testsupport_test.go`
- Test: `backend/internal/handler/checkins_override_test.go`

**Interfaces:**
- Consumes: `models.CheckinOverride`, `models.CreateCheckinOverrideRequest` (Task 1); `h.Store.GetAttendeeByID`, `h.Store.GetEventZoneByID` (existing).
- Produces: `Store.CreateCheckinOverride(ctx, o *models.CheckinOverride) error`; `Handler.CreateCheckinOverride` → `POST /api/events/:event_id/checkins/override`.

- [ ] **Step 1: Add store interface method**

```go
	CreateCheckinOverride(ctx context.Context, o *models.CheckinOverride) error
```

- [ ] **Step 2: Implement the store method**

Create `backend/internal/store/pg_store_overrides.go`:
```go
package store

import (
	"context"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// CreateCheckinOverride records a staff override ("Всё равно пропустить") for
// audit purposes, with the staff member and (optional) zone that triggered it.
func (s *PGStore) CreateCheckinOverride(ctx context.Context, o *models.CheckinOverride) error {
	o.ID = uuid.New()
	o.CreatedAt = time.Now()
	query := `INSERT INTO checkin_overrides (id, attendee_id, zone_id, context, staff_user_id, created_at)
			  VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := s.db.Exec(ctx, query, o.ID, o.AttendeeID, o.ZoneID, o.Context, o.StaffUserID, o.CreatedAt)
	return err
}
```

- [ ] **Step 3: Extend `fakeStore`**

Field:
```go
	createCheckinOverride func(o *models.CheckinOverride) error
```
Wrapper:
```go
func (f *fakeStore) CreateCheckinOverride(_ context.Context, o *models.CheckinOverride) error {
	return f.createCheckinOverride(o)
}
```

- [ ] **Step 4: Write the failing tests**

Create `backend/internal/handler/checkins_override_test.go`:
```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestCreateCheckinOverride_RejectsInvalidContext(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"attendee_id":"` + uuid.New().String() + `","context":"bogus"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/override", body, tenantID.String(), "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.CreateCheckinOverride(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid context, got %d", rec.Code)
	}
}

func TestCreateCheckinOverride_RecordsStaffFromJWT(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	attendeeID := uuid.New()
	var recordedStaff uuid.UUID
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			return &models.Attendee{ID: id, EventID: eventID}, nil
		},
		createCheckinOverride: func(o *models.CheckinOverride) error {
			recordedStaff = o.StaffUserID
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	staffID := uuid.New()
	body := `{"attendee_id":"` + attendeeID.String() + `","context":"already_checked"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/events/"+eventID.String()+"/checkins/override", body, tenantID.String(), staffID, "staff")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.CreateCheckinOverride(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if recordedStaff != staffID {
		t.Fatalf("expected override to record staff %s, got %s", staffID, recordedStaff)
	}
}
```

- [ ] **Step 5: Run to verify failure**

```bash
cd backend && go test ./internal/handler/... -run TestCreateCheckinOverride -v
```
Expected: FAIL — `h.CreateCheckinOverride` undefined.

- [ ] **Step 6: Implement the handler**

Create `backend/internal/handler/checkins_override.go`:
```go
package handler

import (
	"net/http"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

var validOverrideContexts = map[string]bool{
	"already_checked": true,
	"not_registered":  true,
	"no_access":       true,
}

// CreateCheckinOverride records an audit-logged staff override ("Всё равно
// пропустить") for an already-checked / not-registered / no-access verdict.
func (h *Handler) CreateCheckinOverride(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req models.CreateCheckinOverrideRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if !validOverrideContexts[req.Context] {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid context"})
	}

	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), req.AttendeeID)
	if err != nil || attendee == nil || attendee.EventID != eventID {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}
	if req.ZoneID != nil {
		zone, err := h.Store.GetEventZoneByID(c.Request().Context(), *req.ZoneID)
		if err != nil || zone == nil || zone.EventID != eventID {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
		}
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	staffUserID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	override := &models.CheckinOverride{
		AttendeeID:  req.AttendeeID,
		ZoneID:      req.ZoneID,
		Context:     req.Context,
		StaffUserID: staffUserID,
	}
	if err := h.Store.CreateCheckinOverride(c.Request().Context(), override); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to log override"})
	}
	return c.JSON(http.StatusCreated, override)
}
```

- [ ] **Step 7: Register the route**

```go
	api.POST("/events/:event_id/checkins/override", h.CreateCheckinOverride)
```

- [ ] **Step 8: Run tests, full suite, commit**

```bash
cd backend && go test ./internal/handler/... -run TestCreateCheckinOverride -v
cd backend && go build ./... && go vet ./... && go test ./...
git add backend/internal/store/interface.go backend/internal/store/pg_store_overrides.go backend/internal/handler/checkins_override.go backend/internal/handler/checkins_override_test.go backend/internal/handler/handler.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): check-in override audit log — POST /api/events/:event_id/checkins/override"
```

---

### Task 7: KPI stats endpoint — `GET /api/events/:event_id/stats`

**Files:**
- Create: `backend/internal/store/pg_store_stats.go`
- Create: `backend/internal/handler/event_stats.go`
- Modify: `backend/internal/store/interface.go`, `backend/internal/handler/handler.go`, `backend/internal/handler/testsupport_test.go`
- Test: `backend/internal/handler/event_stats_test.go`

**Interfaces:**
- Consumes: `models.EventStatsResponse`, `models.ZoneScanStats` (Task 1); `h.Store.GetEventZoneByID` (existing).
- Produces: `Store.GetEventStats(ctx, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error)`; `Handler.GetEventStats` → `GET /api/events/:event_id/stats?zone=<uuid>`, consumed by the mobile status bar (Phase M1/M2).

- [ ] **Step 1: Add store interface method**

```go
	GetEventStats(ctx context.Context, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error)
```

- [ ] **Step 2: Implement the store method**

Create `backend/internal/store/pg_store_stats.go`:
```go
package store

import (
	"context"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// GetEventStats returns the event's total/checked-in attendee counts, and — if
// zoneID is given — a breakdown of that zone's scan outcomes (from
// zone_scan_log, written by ZoneScan) for the mobile status-bar KPIs.
func (s *PGStore) GetEventStats(ctx context.Context, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error) {
	resp := &models.EventStatsResponse{}

	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`,
		eventID,
	).Scan(&resp.TotalAttendees); err != nil {
		return nil, err
	}

	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL AND checkin_status = true`,
		eventID,
	).Scan(&resp.CheckedIn); err != nil {
		return nil, err
	}

	if zoneID == nil {
		return resp, nil
	}

	zoneStats := &models.ZoneScanStats{}
	rows, err := s.db.Query(ctx,
		`SELECT verdict, COUNT(*) FROM zone_scan_log WHERE zone_id = $1 GROUP BY verdict`,
		*zoneID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var verdict string
		var count int
		if err := rows.Scan(&verdict, &count); err != nil {
			return nil, err
		}
		switch verdict {
		case "allowed":
			zoneStats.Allowed = count
		case "no_access":
			zoneStats.NoAccess = count
		case "not_registered":
			zoneStats.NotRegistered = count
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	resp.ZoneStats = zoneStats
	return resp, nil
}
```

- [ ] **Step 3: Extend `fakeStore`**

Field:
```go
	getEventStats func(eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error)
```
Wrapper:
```go
func (f *fakeStore) GetEventStats(_ context.Context, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error) {
	return f.getEventStats(eventID, zoneID)
}
```

- [ ] **Step 4: Write the failing tests**

Create `backend/internal/handler/event_stats_test.go`:
```go
package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetEventStats_RejectsZoneFromDifferentEvent(t *testing.T) {
	eventID := uuid.New()
	otherEventID := uuid.New()
	tenantID := uuid.New()
	zoneID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: otherEventID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/stats?zone="+zoneID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.GetEventStats(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a zone belonging to a different event, got %d", rec.Code)
	}
}

func TestGetEventStats_ReturnsZoneBreakdown(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	zoneID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventStats: func(_ uuid.UUID, zID *uuid.UUID) (*models.EventStatsResponse, error) {
			return &models.EventStatsResponse{
				TotalAttendees: 2480,
				CheckedIn:      412,
				ZoneStats:      &models.ZoneScanStats{Allowed: 268, NoAccess: 12, NotRegistered: 3},
			}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/stats?zone="+zoneID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.GetEventStats(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp models.EventStatsResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resp.ZoneStats == nil || resp.ZoneStats.Allowed != 268 || resp.ZoneStats.NoAccess != 12 {
		t.Fatalf("unexpected zone stats: %+v", resp.ZoneStats)
	}
}
```

- [ ] **Step 5: Run to verify failure**

```bash
cd backend && go test ./internal/handler/... -run TestGetEventStats -v
```
Expected: FAIL — `h.GetEventStats` undefined.

- [ ] **Step 6: Implement the handler**

Create `backend/internal/handler/event_stats.go`:
```go
package handler

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// GetEventStats returns event-level and (optionally) zone-level KPI counters
// for the mobile status bar. If ?zone= is given, it must belong to this event.
func (h *Handler) GetEventStats(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var zoneID *uuid.UUID
	if zoneParam := c.QueryParam("zone"); zoneParam != "" {
		parsed, err := uuid.Parse(zoneParam)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
		}
		zone, err := h.Store.GetEventZoneByID(c.Request().Context(), parsed)
		if err != nil || zone == nil || zone.EventID != eventID {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
		}
		zoneID = &parsed
	}

	stats, err := h.Store.GetEventStats(c.Request().Context(), eventID, zoneID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, stats)
}
```

- [ ] **Step 7: Register the route**

```go
	api.GET("/events/:event_id/stats", h.GetEventStats)
```

- [ ] **Step 8: Run tests, full suite, commit**

```bash
cd backend && go test ./internal/handler/... -run TestGetEventStats -v
cd backend && go build ./... && go vet ./... && go test ./...
git add backend/internal/store/interface.go backend/internal/store/pg_store_stats.go backend/internal/handler/event_stats.go backend/internal/handler/event_stats_test.go backend/internal/handler/handler.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): event/zone KPI stats — GET /api/events/:event_id/stats"
```

---

### Task 8: Web console — generate station provisioning QR

**Files:**
- Modify: `web/src/pages/event/EventSettings.tsx`

**Interfaces:**
- Consumes: `POST /api/events/:eventId/stations/provisioning-token` (Task 4), `GET /api/users` (existing, returns tenant users with `id`/`email`).
- Produces: a "Generate station QR" button + dialog in the event settings page; no other code depends on this UI.

- [ ] **Step 1: Read the existing local-QR-render pattern to match exactly**

Read `web/src/pages/Users.tsx` (already in the repo) — note its `useEffect` that calls `QRCode.toDataURL(qrToken, {...})` into local state, and its `closeQrDialog()` that wipes the token from state on every close path (overlay/Escape AND the footer button). This task must follow the same pattern: the provisioning token is a credential precursor and must never be sent to a third-party image service, and must be wiped from memory on dialog close.

- [ ] **Step 2: Add state, a staff picker, and the QR dialog to `EventSettings.tsx`**

Add near the top of the `EventSettings` component function, alongside existing `useState` calls:
```tsx
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [provisionDialogOpen, setProvisionDialogOpen] = useState(false);
  const [provisionToken, setProvisionToken] = useState<string>("");
  const [provisionExpiresAt, setProvisionExpiresAt] = useState<string>("");
  const [provisionQrDataUrl, setProvisionQrDataUrl] = useState<string>("");
```

Add the QR-rendering effect (mirrors `Users.tsx`'s pattern exactly — local render, never a third-party image URL):
```tsx
  useEffect(() => {
    if (!provisionToken) {
      setProvisionQrDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(provisionToken, {
      width: 256,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setProvisionQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setProvisionQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [provisionToken]);
```

Add a loader for the staff picker (call once, e.g. alongside the existing event-load `useEffect`):
```tsx
  useEffect(() => {
    api
      .get<Array<{ id: string; email: string }>>("/api/users")
      .then((res) => setStaffUsers(res.data || []))
      .catch(() => setStaffUsers([]));
  }, []);
```

Add the generate handler and the close handler (close wipes the token, matching `Users.tsx`'s `closeQrDialog`):
```tsx
  const handleGenerateProvisioningQR = async () => {
    if (!selectedStaffId) return;
    try {
      const response = await api.post<{ token: string; expires_at: string }>(
        `/api/events/${eventId}/stations/provisioning-token`,
        { staff_user_id: selectedStaffId }
      );
      setProvisionToken(response.data.token);
      setProvisionExpiresAt(response.data.expires_at);
      setProvisionDialogOpen(true);
    } catch (error) {
      console.error("Failed to generate provisioning token", error);
      toast.error(t("failedToGenerateStationQR"));
    }
  };

  const closeProvisionDialog = () => {
    setProvisionDialogOpen(false);
    setProvisionToken("");
    setProvisionExpiresAt("");
  };
```

Add imports at the top of the file (alongside existing imports):
```tsx
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```
(`qrcode` is already a dependency, used by `Users.tsx` — no `package.json` change needed.)

Add the UI block (a card with the staff `Select` + generate button) somewhere in the component's render, alongside the other settings cards:
```tsx
      <Card>
        <CardHeader>
          <CardTitle>{t("stationProvisioning")}</CardTitle>
          <CardDescription>{t("stationProvisioningDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t("selectStaffMember")} />
            </SelectTrigger>
            <SelectContent>
              {staffUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleGenerateProvisioningQR} disabled={!selectedStaffId}>
            {t("generateStationQR")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={provisionDialogOpen} onOpenChange={(open) => { if (!open) closeProvisionDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("stationQrTitle")}</DialogTitle>
            <DialogDescription>
              {t("stationQrDesc")} {provisionExpiresAt && new Date(provisionExpiresAt).toLocaleTimeString()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-4">
            {provisionQrDataUrl ? (
              <img src={provisionQrDataUrl} alt="Station provisioning QR" className="w-64 h-64 border rounded" />
            ) : (
              <div className="w-64 h-64 border rounded flex items-center justify-center text-sm text-muted-foreground">
                …
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={closeProvisionDialog}>{t("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: Add the new i18n keys**

Add to both `web/src/i18n/locales/en.json` and `web/src/i18n/locales/ru.json` (find the existing key list and insert alphabetically or near other event-settings keys):
```json
"stationProvisioning": "Station provisioning",
"stationProvisioningDesc": "Generate a one-time QR code to set up a new mobile check-in/zone-control device for this event.",
"selectStaffMember": "Select staff member",
"generateStationQR": "Generate station QR",
"stationQrTitle": "Station provisioning QR",
"stationQrDesc": "Scan this on the device. Expires at",
"failedToGenerateStationQR": "Failed to generate station QR"
```
(Russian file: translate accordingly, e.g. `"stationProvisioning": "Провижининг станции"`, `"stationProvisioningDesc": "Сгенерируйте одноразовый QR-код для настройки нового мобильного устройства (чек-ин/контроль зоны) для этого мероприятия."`, `"selectStaffMember": "Выберите сотрудника"`, `"generateStationQR": "Сгенерировать QR станции"`, `"stationQrTitle": "QR для настройки станции"`, `"stationQrDesc": "Отсканируйте на устройстве. Истекает в"`, `"failedToGenerateStationQR": "Не удалось сгенерировать QR станции"`.)

- [ ] **Step 4: Type-check and build**

```bash
cd web && npm run type-check && npm run build
```
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 5: Manual smoke check**

```bash
cd web && npm run dev
```
Navigate to an event's Settings page in the browser; confirm the "Station provisioning" card renders, the staff `Select` populates from `/api/users`, clicking "Generate station QR" opens the dialog with a rendered QR image, and closing the dialog (Escape, overlay click, and the Close button) each clear the token (verify via React DevTools or by re-opening — the dialog should show the loading placeholder again if reopened without clicking Generate).

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/event/EventSettings.tsx web/src/i18n/locales/en.json web/src/i18n/locales/ru.json
git commit -m "feat(web): generate station provisioning QR from event settings"
```

---

### Task 9: Final verification, backend Phase B summary, PR

**Files:**
- Create: `docs/audit/mobile-redesign-phase-b-backend-summary.md`

- [ ] **Step 1: Full backend gate**

```bash
cd backend
go build ./...
go vet ./...
go test ./... -v 2>&1 | tail -80
gofmt -l . # expect empty output
```

- [ ] **Step 2: Lint + security scanners (match existing CI gates)**

```bash
cd backend
golangci-lint run ./...
gosec ./...
govulncheck ./...
```
Expected: 0 issues on all three (matches the bar set by every prior backend phase in this project).

- [ ] **Step 3: Re-verify the migration end-to-end against a clean database**

```bash
cd /Users/thevladbog/PRSOME/idento
docker compose down -v db  # wipe the local db volume for a clean-slate check
docker compose up -d db
sleep 3
export DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable"
cd backend && go run ./cmd/migrate
```
Expected: all 13 migrations apply cleanly from scratch, exit 0.

- [ ] **Step 4: Web gate**

```bash
cd web && npm run type-check && npm run lint && npm run build
```
Expected: all green (this also re-verifies Task 8's change alongside the rest of the app).

- [ ] **Step 5: Write the phase summary**

Create `docs/audit/mobile-redesign-phase-b-backend-summary.md` covering: what was added (table by table, endpoint by endpoint), the deliberate divergences from the legacy `/api/zones/checkin` (structured 200-verdict response; stricter no-category-with-rules denial in `CheckZoneAccessAt`), the design decision that provisioning mints a JWT for a manager-selected existing staff user (not the generating manager), and the full gate table (build/vet/test/lint/gosec/govulncheck/migration/web — all green). List the new endpoints with method+path+one-line purpose.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin redesign/mobile-spec  # or a dedicated branch — see note below
gh pr create --base main --title "Phase B: mobile redesign backend contract (stations, zone-scan verdicts, batch check-in, overrides, stats)" --body-file <(cat docs/audit/mobile-redesign-phase-b-backend-summary.md)
```

**Note for the controller running this plan:** decide before Task 1 whether Phase B lands on its own fresh branch off `origin/main` (matching every prior phase in this project's history, e.g. `audit/phase2c-agent-hardening`) or continues on `redesign/mobile-spec` (which currently holds only the design-doc commit). This plan's steps are branch-agnostic; create the branch as the very first action if a fresh one is wanted, via `git checkout -b redesign/phase-b-backend origin/main`.

## Self-Review Notes (author's pass)

- **Spec coverage:** all 5 items from design §5.1 are covered — zone rules+scan (Tasks 2-3), stations+provisioning (Task 4), batch check-in (Task 5), override log (Task 6), KPI stats (Task 7) — plus the web-console touchpoint the phase table in §10 calls for (Task 8).
- **Divergence from the design doc's illustrative paths, called out explicitly:** the design text shows `POST /api/checkins/batch` and doesn't nest it under an event; this plan nests all new mutating endpoints under `/api/events/:event_id/...` or `/api/zones/:zone_id/...` for consistency with every existing endpoint's tenant-authz pattern (a bare top-level path would need per-item tenant checks with no path-level ownership gate). Flagged in Global Constraints.
- **Type/signature consistency checked:** `models.BatchCheckinItem`/`BatchCheckinResult` (Task 1) match exactly what Tasks 5's store method and handler use; `models.ZoneScanResponse` (Task 1, includes `FirstEntry` field) matches Task 3's handler; `Store` interface additions in Task 1's prose are formally added in each consuming task (2, 4, 5, 6, 7) rather than all at once, so each task is independently compilable and testable in sequence.
- **No placeholders:** every step has complete, concrete code — no `// TODO`, no "add validation here".
