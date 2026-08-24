package store

import (
	"context"
	"os"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestTenantScopedUsageAggregates_RealPostgres pins the scoped aggregates
// that the console's "over limit" logic needs: the plan limits are
// events_PER_MONTH and attendees_PER_EVENT, but GetAllTenants/GetTenantStats
// used to expose only tenant-wide cumulative totals — the Batch-1 audit's
// documented scope mismatch. The new fields mirror the enforcement
// semantics exactly: events_this_month counts live (deleted_at IS NULL)
// events created since date_trunc('month', NOW()) (CheckTenantLimit's
// query), and max_attendees_per_event is the peak per-live-event count of
// live attendees (CheckAttendeeLimit's counting rule, maxed over events).
//
// Gated behind TEST_DATABASE_URL and SKIPS when unset (the established
// integration-test idiom of this package). To run locally against the
// docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestTenantScopedUsageAggregates_RealPostgres -v
func TestTenantScopedUsageAggregates_RealPostgres(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres scoped-stats test (see doc comment for how to run it)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
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
	mustExec := func(what, sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	}

	mustExec("insert tenant",
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
		tenantID, "Scoped Stats "+tenantID.String())
	t.Cleanup(func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup: %v", err)
		}
	})

	// Events: created_at anchored to date_trunc('month', NOW()) so the test
	// is deterministic on every calendar day, including the 1st.
	//   eventOld     — last month, 5 live + 2 deleted attendees (the peak).
	//   eventNew     — this month, 3 live attendees.
	//   eventDeleted — this month but soft-deleted: counts nowhere.
	eventOld, eventNew, eventDeleted := uuid.New(), uuid.New(), uuid.New()
	mustExec("insert old event",
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at)
		 VALUES ($1, $2, 'Old', date_trunc('month', NOW()) - interval '5 days', NOW())`,
		eventOld, tenantID)
	mustExec("insert new event",
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at)
		 VALUES ($1, $2, 'New', date_trunc('month', NOW()) + interval '1 hour', NOW())`,
		eventNew, tenantID)
	mustExec("insert deleted event",
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at, deleted_at)
		 VALUES ($1, $2, 'Deleted', date_trunc('month', NOW()) + interval '2 hours', NOW(), NOW())`,
		eventDeleted, tenantID)

	insertAttendees := func(eventID uuid.UUID, tag string, live, deleted int) {
		t.Helper()
		for i := 0; i < live; i++ {
			mustExec("insert live attendee",
				`INSERT INTO attendees (id, event_id, first_name, last_name, code, created_at, updated_at)
				 VALUES ($1, $2, 'A', 'Live', $3, NOW(), NOW())`,
				uuid.New(), eventID, tag+"-L"+uuid.NewString()[:8])
		}
		for i := 0; i < deleted; i++ {
			mustExec("insert deleted attendee",
				`INSERT INTO attendees (id, event_id, first_name, last_name, code, created_at, updated_at, deleted_at)
				 VALUES ($1, $2, 'A', 'Gone', $3, NOW(), NOW(), NOW())`,
				uuid.New(), eventID, tag+"-D"+uuid.NewString()[:8])
		}
	}
	insertAttendees(eventOld, "old", 5, 2)
	insertAttendees(eventNew, "new", 3, 0)
	insertAttendees(eventDeleted, "del", 9, 0) // peak-looking, but its event is deleted

	assertScoped := func(t *testing.T, what string, tws *models.TenantWithStats) {
		t.Helper()
		if tws.EventsThisMonth != 1 {
			t.Errorf("%s events_this_month = %d, want 1 (live this-month events only)", what, tws.EventsThisMonth)
		}
		if tws.MaxAttendeesPerEvent != 5 {
			t.Errorf("%s max_attendees_per_event = %d, want 5 (live attendees of the busiest live event)", what, tws.MaxAttendeesPerEvent)
		}
	}

	t.Run("GetTenantStats exposes the scoped aggregates", func(t *testing.T) {
		tws, err := s.GetTenantStats(ctx, tenantID)
		if err != nil {
			t.Fatalf("GetTenantStats: %v", err)
		}
		assertScoped(t, "GetTenantStats", tws)
	})

	t.Run("GetAllTenants exposes the scoped aggregates for the same tenant", func(t *testing.T) {
		all, err := s.GetAllTenants(ctx, nil)
		if err != nil {
			t.Fatalf("GetAllTenants: %v", err)
		}
		for _, tws := range all {
			if tws.Tenant != nil && tws.Tenant.ID == tenantID {
				assertScoped(t, "GetAllTenants", tws)
				return
			}
		}
		t.Fatal("seeded tenant not present in GetAllTenants")
	})
}
