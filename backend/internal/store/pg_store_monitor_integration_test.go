package store

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestGetMonitorZones_RealPostgres_InvariantHoldsByConstruction proves,
// against a REAL Postgres database, the load-bearing correctness property
// of GetMonitorZones: sum(zones[].CheckedIn) + unattributed == checkedIn.
// pgxmock (used by every other test in this file) only echoes back rows
// it's told to return — it can prove the SQL's exact text and this
// package's row-scanning logic, but it cannot execute the DISTINCT ON
// most-recent-action tie-breaking or the UNION ALL aggregation for real, so
// it cannot prove the query is even syntactically valid, let alone that it
// picks the right zone per attendee. This is the only test in the repo that
// can (same rationale as
// TestCheckinCompositeForeignKeys_RejectCrossEventReferences).
//
// The fixture also proves the DISTINCT ON tie-breaker matters: attendee A1
// has an OLDER 'checkin' action pointing at Station 2 / Zone Two, then a
// NEWER one pointing at Station 1 / Zone One — GetMonitorZones must
// attribute A1 to Zone One (the most recent), not Zone Two.
//
// Gated behind TEST_DATABASE_URL (this codebase has no real-database CI
// harness — see pg_store_attendees_page_integration_test.go) and SKIPS, not
// fails, when it's unset. To run it locally against the docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestGetMonitorZones_RealPostgres -v
func TestGetMonitorZones_RealPostgres_InvariantHoldsByConstruction(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres monitor-aggregation test (see doc comment for how to run it)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	s := &PGStore{db: pool}
	if err := s.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	tenantID := uuid.New()
	eventID := uuid.New()
	now := time.Now()

	if _, err := pool.Exec(ctx,
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
		tenantID, "Monitor Aggregation Test Tenant "+tenantID.String(), now,
	); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		// Cascades through events -> event_zones/attendees/checkin_stations/checkin_actions.
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup: failed to delete tenant %s: %v", tenantID, err)
		}
	})

	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		eventID, tenantID, "Monitor Aggregation Test Event", now,
	); err != nil {
		t.Fatalf("insert event: %v", err)
	}

	zoneOne := uuid.New()
	zoneTwo := uuid.New()
	zoneEmpty := uuid.New()
	for _, z := range []struct {
		id         uuid.UUID
		name       string
		orderIndex int
	}{
		{zoneTwo, "Zone Two", 1},
		{zoneOne, "Zone One", 2},
		{zoneEmpty, "Zone Three (empty)", 3},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO event_zones (id, event_id, name, order_index, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
			z.id, eventID, z.name, z.orderIndex, now,
		); err != nil {
			t.Fatalf("insert zone %s: %v", z.name, err)
		}
	}

	station1 := uuid.New()
	station2 := uuid.New()
	stationless := uuid.New()
	for _, st := range []struct {
		id     uuid.UUID
		name   string
		zoneID *uuid.UUID
	}{
		{station1, "Station 1", &zoneOne},
		{station2, "Station 2", &zoneTwo},
		{stationless, "Station Stationless", nil},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO checkin_stations (id, event_id, name, zone_id, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)`,
			st.id, eventID, st.name, st.zoneID, now,
		); err != nil {
			t.Fatalf("insert station %s: %v", st.name, err)
		}
	}

	// A1: checked in, most-recent action -> station1/zoneOne (an OLDER
	// action pointing at station2/zoneTwo must be superseded).
	// A2: checked in, single action -> station2/zoneTwo.
	// A3: checked in, action via the station-less station -> unattributed.
	// A4: checked in, only an 'undo' action (no 'checkin' row at all) -> unattributed.
	// A5: NOT checked in -> excluded entirely from every count.
	// A6: soft-deleted -> excluded entirely from every count.
	attendees := []struct {
		id        uuid.UUID
		checkedIn bool
		deleted   bool
	}{
		{uuid.New(), true, false},  // A1
		{uuid.New(), true, false},  // A2
		{uuid.New(), true, false},  // A3
		{uuid.New(), true, false},  // A4
		{uuid.New(), false, false}, // A5
		{uuid.New(), true, true},   // A6
	}
	for i, a := range attendees {
		var deletedAt *time.Time
		if a.deleted {
			deletedAt = &now
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO attendees (id, event_id, first_name, last_name, code, checkin_status, checked_in_at, deleted_at, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
			a.id, eventID, "A", uuid.New().String()[:8], "CODE-"+uuid.New().String()[:8], a.checkedIn, now, deletedAt, now,
		); err != nil {
			t.Fatalf("insert attendee[%d]: %v", i, err)
		}
	}
	a1, a2, a3, a4 := attendees[0].id, attendees[1].id, attendees[2].id, attendees[3].id

	insertAction := func(attendeeID uuid.UUID, stationID *uuid.UUID, action string, createdAt time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO checkin_actions (id, event_id, attendee_id, station_id, action, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
			uuid.New(), eventID, attendeeID, stationID, action, createdAt,
		); err != nil {
			t.Fatalf("insert checkin_action(attendee=%s, action=%s): %v", attendeeID, action, err)
		}
	}
	insertAction(a1, &station2, "checkin", now.Add(-10*time.Minute)) // superseded
	insertAction(a1, &station1, "checkin", now.Add(-1*time.Minute))  // wins: most recent
	insertAction(a2, &station2, "checkin", now.Add(-5*time.Minute))
	insertAction(a3, &stationless, "checkin", now.Add(-3*time.Minute))
	insertAction(a4, &station1, "undo", now.Add(-2*time.Minute)) // no 'checkin' row for A4 at all

	total, checkedIn, err := s.GetMonitorCounts(ctx, eventID)
	if err != nil {
		t.Fatalf("GetMonitorCounts: %v", err)
	}
	if total != 5 {
		t.Errorf("total = %d, want 5 (excludes the soft-deleted A6)", total)
	}
	if checkedIn != 4 {
		t.Errorf("checkedIn = %d, want 4 (A1-A4; A5 not checked in, A6 soft-deleted)", checkedIn)
	}

	zones, unattributed, err := s.GetMonitorZones(ctx, eventID)
	if err != nil {
		t.Fatalf("GetMonitorZones: %v", err)
	}
	if len(zones) != 3 {
		t.Fatalf("len(zones) = %d, want 3 (all event_zones, including the empty one)", len(zones))
	}
	// order_index order: Zone Two (1), Zone One (2), Zone Three (3).
	if zones[0].ZoneID != zoneTwo || zones[0].CheckedIn != 1 {
		t.Errorf("zones[0] = %+v, want Zone Two with CheckedIn=1 (A2)", zones[0])
	}
	if zones[1].ZoneID != zoneOne || zones[1].CheckedIn != 1 {
		t.Errorf("zones[1] = %+v, want Zone One with CheckedIn=1 (A1, via its MOST RECENT action)", zones[1])
	}
	if zones[2].ZoneID != zoneEmpty || zones[2].CheckedIn != 0 {
		t.Errorf("zones[2] = %+v, want the empty zone with CheckedIn=0 (zero-count zones must still be listed)", zones[2])
	}
	if unattributed != 2 {
		t.Errorf("unattributed = %d, want 2 (A3: station-less action; A4: no 'checkin' action row at all)", unattributed)
	}

	sum := 0
	for _, z := range zones {
		sum += z.CheckedIn
	}
	if sum+unattributed != checkedIn {
		t.Errorf("sum(zones)+unattributed = %d+%d = %d, want %d (checkedIn) — invariant broken", sum, unattributed, sum+unattributed, checkedIn)
	}

	buckets, err := s.GetMonitorMinuteBuckets(ctx, eventID, now.Add(-24*time.Hour))
	if err != nil {
		t.Fatalf("GetMonitorMinuteBuckets: %v", err)
	}
	bucketTotal := 0
	for i, b := range buckets {
		bucketTotal += b.Count
		if i > 0 && !buckets[i-1].Minute.Before(b.Minute) {
			t.Errorf("buckets not strictly ascending at index %d: %v then %v", i, buckets[i-1].Minute, b.Minute)
		}
	}
	if bucketTotal != 4 {
		t.Errorf("sum of bucket counts = %d, want 4 (A1 has 2 'checkin' rows, A2 and A3 have 1 each; A4's only action is 'undo', excluded)", bucketTotal)
	}

	stations, err := s.GetMonitorStations(ctx, eventID)
	if err != nil {
		t.Fatalf("GetMonitorStations: %v", err)
	}
	if len(stations) != 3 {
		t.Fatalf("len(stations) = %d, want 3", len(stations))
	}
	byID := map[uuid.UUID]MonitorStation{}
	for _, st := range stations {
		byID[st.ID] = st
	}
	// Station 1 received A1's newer 'checkin' AND A4's 'undo' — the FILTER
	// must count only the 'checkin' row.
	if got := byID[station1].CheckinCount; got != 1 {
		t.Errorf("station1.CheckinCount = %d, want 1 (the 'undo' row must not inflate it)", got)
	}
	// Station 2 received A1's older 'checkin' AND A2's 'checkin'.
	if got := byID[station2].CheckinCount; got != 2 {
		t.Errorf("station2.CheckinCount = %d, want 2", got)
	}
	if got := byID[stationless].CheckinCount; got != 1 {
		t.Errorf("stationless.CheckinCount = %d, want 1", got)
	}
}
