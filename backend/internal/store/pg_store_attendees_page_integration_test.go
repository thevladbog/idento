package store

import (
	"context"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSeeded5kAttendees_ScaleExitCriterion is the P2.1 phase's scale exit
// criterion: it seeds 5,000 attendees on one event against a REAL Postgres
// database (not pgxmock — pgxmock only echoes back rows it's told to return,
// so it cannot prove LIMIT/OFFSET/COUNT(*)/JOIN correctness at scale) and
// asserts GetAttendeesPage's pagination, status filter, zone filter, and
// search filter are all exactly correct against that data.
//
// This codebase has no existing real-database test harness (every other
// store test uses pgxmock; there is no Postgres service in
// .github/workflows/validate.yml), so this test is deliberately gated behind
// TEST_DATABASE_URL and SKIPS (not fails) when it's unset — a known,
// intentional gap, not a silent omission. CI does not currently set this
// var, so this test does not run there; wiring a Postgres service into CI so
// it runs on every PR is tracked as a separate follow-up, not part of this
// task. To run it locally against the docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestSeeded5kAttendees_ScaleExitCriterion -v
func TestSeeded5kAttendees_ScaleExitCriterion(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres 5k-attendee scale test (see doc comment for how to run it)")
	}

	// Bound the whole test (pool setup, migrations, seeding 5,000 rows via
	// CopyFrom, and every subtest query) so an unreachable/hanging database
	// fails fast with a clear timeout instead of blocking indefinitely.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	// Registered before the tenant-delete cleanup below so it runs after it
	// (t.Cleanup is LIFO) — otherwise the pool closes before the cleanup
	// query that deletes the seeded tenant can run.
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
	zoneID := uuid.New()
	now := time.Now()

	if _, err := pool.Exec(ctx,
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
		tenantID, "Scale Test Tenant "+tenantID.String(), now,
	); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		// Cascades through events -> attendees/event_zones -> attendee_zone_access.
		// Uses its own timeout-bound context (not the main test ctx, which
		// defer cancel() above has already cancelled by the time cleanups
		// run) — bounded separately so a hung delete still fails fast rather
		// than blocking test teardown indefinitely.
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup: failed to delete tenant %s: %v", tenantID, err)
		}
	})

	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		eventID, tenantID, "Scale Test Event", now,
	); err != nil {
		t.Fatalf("insert event: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO event_zones (id, event_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		zoneID, eventID, "Scale Test Zone", now,
	); err != nil {
		t.Fatalf("insert event_zone: %v", err)
	}

	const total = 5000
	const checkedInCount = 1000
	const zoneAccessCount = 500
	const uniqueMarkerIndex = 2500
	const uniqueSearchToken = "zyxqmarker9f3a"

	type seedAttendee struct {
		id        uuid.UUID
		firstName string
	}
	seeded := make([]seedAttendee, 0, total)

	rows := make([][]interface{}, 0, total)
	for i := 0; i < total; i++ {
		id := uuid.New()
		firstName := fmt.Sprintf("Scale%04d", i)
		if i == uniqueMarkerIndex {
			// Distinct, non-"Scale"-prefixed name so a search on
			// uniqueSearchToken matches exactly this one attendee.
			firstName = "ZyxQMarker9f3a"
		}
		checkedIn := i < checkedInCount
		seeded = append(seeded, seedAttendee{id: id, firstName: firstName})
		rows = append(rows, []interface{}{
			// company/position are non-pointer `string` fields on
			// models.Attendee even though the DB columns are nullable — every
			// real INSERT path (CreateAttendee) always writes "" rather than
			// leaving them NULL, so match that here to seed realistic rows
			// (a NULL company/position fails Scan with "cannot scan NULL into
			// *string", caught by an earlier version of this test).
			id, eventID, firstName, "Attendee", fmt.Sprintf("scale%04d@example.com", i), "", "",
			fmt.Sprintf("SCALE-%04d", i), checkedIn, now, now,
		})
	}

	copyCount, err := pool.CopyFrom(ctx,
		pgx.Identifier{"attendees"},
		[]string{"id", "event_id", "first_name", "last_name", "email", "company", "position", "code", "checkin_status", "created_at", "updated_at"},
		pgx.CopyFromRows(rows),
	)
	if err != nil {
		t.Fatalf("CopyFrom attendees: %v", err)
	}
	if copyCount != total {
		t.Fatalf("CopyFrom inserted %d rows, want %d", copyCount, total)
	}

	zoneRows := make([][]interface{}, 0, zoneAccessCount)
	for i := 0; i < zoneAccessCount; i++ {
		zoneRows = append(zoneRows, []interface{}{uuid.New(), seeded[i].id, zoneID, true, now, now})
	}
	zoneCopyCount, err := pool.CopyFrom(ctx,
		pgx.Identifier{"attendee_zone_access"},
		[]string{"id", "attendee_id", "zone_id", "allowed", "created_at", "updated_at"},
		pgx.CopyFromRows(zoneRows),
	)
	if err != nil {
		t.Fatalf("CopyFrom attendee_zone_access: %v", err)
	}
	if zoneCopyCount != zoneAccessCount {
		t.Fatalf("CopyFrom inserted %d zone-access rows, want %d", zoneCopyCount, zoneAccessCount)
	}

	// A bulk CopyFrom does not trigger a synchronous ANALYZE, and
	// autovacuum's own analyze may not have run yet within this test's
	// tight window -- confirmed empirically during P5.3.5 planning: without
	// this, the planner drastically underestimates the zone-filtered
	// query's selectivity (rows=1 estimated vs 500 actual) and picks a
	// Nested Loop that probes attendee_zone_access once per attendee
	// (5,000 iterations) instead of a Hash Join starting from the ~500
	// actually-matching rows -- ~300ms instead of ~2-3ms, using only
	// indexes that already exist. Explicitly analyzing after a bulk
	// write is exactly what a real bulk import should do too (see
	// PGStore.AnalyzeAttendeesTable, called from BulkCreateAttendees) --
	// this keeps the test's baseline representative of that same,
	// now-fixed, steady state rather than a worst-case transient one.
	if _, err := pool.Exec(ctx, `ANALYZE attendees`); err != nil {
		t.Fatalf("ANALYZE attendees: %v", err)
	}
	if _, err := pool.Exec(ctx, `ANALYZE attendee_zone_access`); err != nil {
		t.Fatalf("ANALYZE attendee_zone_access: %v", err)
	}

	// expectedOrder mirrors GetAttendeesPage's ORDER BY last_name, first_name,
	// id — every seeded attendee shares last_name "Attendee", so this reduces
	// to an ascending sort on first_name (ids only break ties, and every
	// first_name here is unique).
	expectedOrder := make([]seedAttendee, len(seeded))
	copy(expectedOrder, seeded)
	sort.Slice(expectedOrder, func(i, j int) bool { return expectedOrder[i].firstName < expectedOrder[j].firstName })

	t.Run("unfiltered total is exactly 5000", func(t *testing.T) {
		_, gotTotal, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{Page: 1, PerPage: 1})
		if err != nil {
			t.Fatalf("GetAttendeesPage: %v", err)
		}
		if gotTotal != total {
			t.Fatalf("total = %d, want %d", gotTotal, total)
		}
	})

	t.Run("page 100 of 50 returns exactly the 50 attendees at that offset, no overlap/gap with adjacent pages", func(t *testing.T) {
		page99, total99, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{Page: 99, PerPage: 50})
		if err != nil {
			t.Fatalf("GetAttendeesPage page 99: %v", err)
		}
		page100, total100, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{Page: 100, PerPage: 50})
		if err != nil {
			t.Fatalf("GetAttendeesPage page 100: %v", err)
		}
		if total99 != total || total100 != total {
			t.Fatalf("total99=%d total100=%d, want both %d", total99, total100, total)
		}
		if len(page99) != 50 || len(page100) != 50 {
			t.Fatalf("len(page99)=%d len(page100)=%d, want 50/50", len(page99), len(page100))
		}

		wantPage99 := expectedOrder[4900:4950]
		wantPage100 := expectedOrder[4950:5000]
		for i, a := range page99 {
			if a.ID != wantPage99[i].id {
				t.Fatalf("page99[%d].ID = %s, want %s (first_name=%s)", i, a.ID, wantPage99[i].id, wantPage99[i].firstName)
			}
		}
		for i, a := range page100 {
			if a.ID != wantPage100[i].id {
				t.Fatalf("page100[%d].ID = %s, want %s (first_name=%s)", i, a.ID, wantPage100[i].id, wantPage100[i].firstName)
			}
		}

		// No overlap between adjacent pages, and together they cover exactly
		// the expected 100 attendees (no gap).
		seen := map[uuid.UUID]bool{}
		for _, a := range page99 {
			seen[a.ID] = true
		}
		for _, a := range page100 {
			if seen[a.ID] {
				t.Fatalf("attendee %s appears in both page99 and page100", a.ID)
			}
			seen[a.ID] = true
		}
		if len(seen) != 100 {
			t.Fatalf("len(seen) = %d, want 100 (50 unique per page, no gap)", len(seen))
		}
	})

	t.Run("a page past the end returns an empty array with the correct total", func(t *testing.T) {
		attendees, gotTotal, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{Page: 101, PerPage: 50})
		if err != nil {
			t.Fatalf("GetAttendeesPage: %v", err)
		}
		if len(attendees) != 0 {
			t.Fatalf("len(attendees) = %d, want 0 (page past the end)", len(attendees))
		}
		if gotTotal != total {
			t.Fatalf("total = %d, want %d (total is unaffected by an empty page)", gotTotal, total)
		}
	})

	t.Run("status=checked_in total is exactly the seeded checked-in count", func(t *testing.T) {
		checkedIn := true
		attendees, gotTotal, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{Status: &checkedIn, Page: 1, PerPage: 50})
		if err != nil {
			t.Fatalf("GetAttendeesPage: %v", err)
		}
		if gotTotal != checkedInCount {
			t.Fatalf("total = %d, want %d", gotTotal, checkedInCount)
		}
		for _, a := range attendees {
			if !a.CheckinStatus {
				t.Fatalf("attendee %s has checkin_status=false in a status=checked_in page", a.ID)
			}
		}
	})

	t.Run("zone filter total is exactly the seeded zone-access count", func(t *testing.T) {
		attendees, gotTotal, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{ZoneID: &zoneID, Page: 1, PerPage: 50})
		if err != nil {
			t.Fatalf("GetAttendeesPage: %v", err)
		}
		if gotTotal != zoneAccessCount {
			t.Fatalf("total = %d, want %d", gotTotal, zoneAccessCount)
		}
		if len(attendees) != 50 {
			t.Fatalf("len(attendees) = %d, want 50 (first page of a 500-total, 50-per-page result)", len(attendees))
		}
	})

	t.Run("search on the uniquely-generated name returns exactly that one attendee", func(t *testing.T) {
		attendees, gotTotal, err := s.GetAttendeesPage(ctx, eventID, AttendeeFilter{Search: uniqueSearchToken, Page: 1, PerPage: 50})
		if err != nil {
			t.Fatalf("GetAttendeesPage: %v", err)
		}
		if gotTotal != 1 {
			t.Fatalf("total = %d, want 1", gotTotal)
		}
		if len(attendees) != 1 {
			t.Fatalf("len(attendees) = %d, want 1", len(attendees))
		}
		if attendees[0].ID != seeded[uniqueMarkerIndex].id {
			t.Fatalf("got attendee %s, want the uniquely-named one %s", attendees[0].ID, seeded[uniqueMarkerIndex].id)
		}
	})

	t.Run("all 4 query shapes complete within 100ms once statistics are fresh", func(t *testing.T) {
		checkedIn := true
		shapes := []struct {
			name   string
			filter AttendeeFilter
		}{
			{"unfiltered page", AttendeeFilter{Page: 100, PerPage: 50}},
			{"status filter", AttendeeFilter{Status: &checkedIn, Page: 1, PerPage: 50}},
			{"zone filter", AttendeeFilter{ZoneID: &zoneID, Page: 1, PerPage: 50}},
			{"search", AttendeeFilter{Search: uniqueSearchToken, Page: 1, PerPage: 50}},
		}
		// A generous, evidence-derived bound (P5.3.5 planning measured
		// steady-state times of ~2-18ms across these 4 shapes once
		// statistics are fresh) -- not a tight SLA. It exists to catch a
		// genuine regression (e.g. the ~300ms stale-statistics class of
		// bug this task's own ANALYZE fix resolves), not to enforce a
		// specific latency target.
		const bound = 100 * time.Millisecond
		for _, shape := range shapes {
			// One warm-up call (plan caching / connection warmup) before
			// the measured call, so the assertion reflects steady-state
			// query cost, not one-time first-call overhead.
			if _, _, err := s.GetAttendeesPage(ctx, eventID, shape.filter); err != nil {
				t.Fatalf("%s warm-up: %v", shape.name, err)
			}
			start := time.Now()
			_, _, err := s.GetAttendeesPage(ctx, eventID, shape.filter)
			elapsed := time.Since(start)
			if err != nil {
				t.Fatalf("%s: %v", shape.name, err)
			}
			if elapsed > bound {
				t.Errorf("%s took %v, want <= %v", shape.name, elapsed, bound)
			}
		}
	})
}
