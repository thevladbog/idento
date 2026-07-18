package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestCheckinCompositeForeignKeys_RejectCrossEventReferences proves, against
// a REAL Postgres database, that migration 000020's composite (id, event_id)
// foreign keys reject a cross-event zone_id/attendee_id/station_id — not
// just that the app layer happens to validate this on every current write
// path. pgxmock (used by every other store test) only echoes back rows it's
// told to return, so it cannot prove a constraint is even syntactically
// valid, let alone enforced; this is the only test in the repo that can.
//
// This codebase has no existing real-database CI harness (see
// pg_store_attendees_page_integration_test.go), so this test is gated
// behind TEST_DATABASE_URL and SKIPS (not fails) when it's unset. To run it
// locally against the docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestCheckinCompositeForeignKeys_RejectCrossEventReferences -v
func TestCheckinCompositeForeignKeys_RejectCrossEventReferences(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres composite-FK test (see doc comment for how to run it)")
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
	eventA := uuid.New()
	eventB := uuid.New()
	now := time.Now()

	if _, err := pool.Exec(ctx,
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
		tenantID, "Composite FK Test Tenant "+tenantID.String(), now,
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

	for _, id := range []uuid.UUID{eventA, eventB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
			id, tenantID, "Composite FK Test Event "+id.String(), now,
		); err != nil {
			t.Fatalf("insert event %s: %v", id, err)
		}
	}

	zoneA := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_zones (id, event_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		zoneA, eventA, "Zone A", now,
	); err != nil {
		t.Fatalf("insert event_zone: %v", err)
	}

	attendeeA := uuid.New()
	attendeeB := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO attendees (id, event_id, first_name, last_name, code, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
		attendeeA, eventA, "Alice", "A", "CODE-A", now,
	); err != nil {
		t.Fatalf("insert attendeeA: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO attendees (id, event_id, first_name, last_name, code, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
		attendeeB, eventB, "Bob", "B", "CODE-B", now,
	); err != nil {
		t.Fatalf("insert attendeeB: %v", err)
	}

	stationA := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO checkin_stations (id, event_id, name, zone_id, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)`,
		stationA, eventA, "Station A", zoneA, now,
	); err != nil {
		t.Fatalf("insert stationA: %v", err)
	}
	stationB := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO checkin_stations (id, event_id, name, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)`,
		stationB, eventB, "Station B", now,
	); err != nil {
		t.Fatalf("insert stationB: %v", err)
	}

	assertForeignKeyViolation := func(t *testing.T, err error) {
		t.Helper()
		if err == nil {
			t.Fatal("expected a foreign key violation, got no error")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) {
			t.Fatalf("expected a *pgconn.PgError, got %T: %v", err, err)
		}
		if pgErr.Code != "23503" {
			t.Fatalf("expected SQLSTATE 23503 (foreign_key_violation), got %s: %v", pgErr.Code, err)
		}
	}

	t.Run("checkin_stations.zone_id from a different event is rejected", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`INSERT INTO checkin_stations (id, event_id, name, zone_id, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)`,
			uuid.New(), eventB, "Cross-event station", zoneA, now,
		)
		assertForeignKeyViolation(t, err)
	})

	t.Run("checkin_actions.attendee_id from a different event is rejected", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`INSERT INTO checkin_actions (id, event_id, attendee_id, action, created_at) VALUES ($1, $2, $3, 'checkin', $4)`,
			uuid.New(), eventA, attendeeB, now,
		)
		assertForeignKeyViolation(t, err)
	})

	t.Run("checkin_actions.station_id from a different event is rejected", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`INSERT INTO checkin_actions (id, event_id, attendee_id, station_id, action, created_at) VALUES ($1, $2, $3, $4, 'checkin', $5)`,
			uuid.New(), eventA, attendeeA, stationB, now,
		)
		assertForeignKeyViolation(t, err)
	})

	t.Run("same-event references and a NULL station_id are accepted", func(t *testing.T) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO checkin_stations (id, event_id, name, zone_id, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)`,
			uuid.New(), eventA, "Same-event station", zoneA, now,
		); err != nil {
			t.Fatalf("same-event zone_id insert should succeed, got: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO checkin_actions (id, event_id, attendee_id, station_id, action, created_at) VALUES ($1, $2, $3, $4, 'checkin', $5)`,
			uuid.New(), eventA, attendeeA, stationA, now,
		); err != nil {
			t.Fatalf("same-event attendee_id/station_id insert should succeed, got: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO checkin_actions (id, event_id, attendee_id, station_id, action, created_at) VALUES ($1, $2, $3, NULL, 'checkin', $4)`,
			uuid.New(), eventA, attendeeA, now,
		); err != nil {
			t.Fatalf("NULL station_id insert should bypass the composite FK (MATCH SIMPLE), got: %v", err)
		}
	})
}
