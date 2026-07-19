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

// TestApplyBatchCheckin_RealPostgres_EventWideActionsFeed proves, against a
// REAL Postgres, the 2026-07-19 event-wide actions-feed contract for the
// mobile batch path end-to-end: a Created kind=checkin batch item (a) writes
// exactly one station-less 'checkin' action row whose created_at EQUALS both
// item.At and the attendees.checked_in_at the guarded UPDATE persisted (the
// monitor's current-period predicate holds by equality), (b) is counted by
// CountRecentCheckins and lands in its true historical minute bucket in
// GetMonitorMinuteBuckets, (c) appears in GetCheckinActions, and (d) lands in
// GetMonitorOverview's unattributed bucket with the zones+unattributed ==
// checked_in invariant intact — while replays (same client_uuid) and
// already-checked-in retries (new client_uuid) add NO further rows. pgxmock
// cannot prove any of this for real (same rationale as
// TestGetMonitorOverview_RealPostgres_InvariantHoldsByConstruction).
//
// Gated behind TEST_DATABASE_URL and SKIPS when unset. To run locally:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestApplyBatchCheckin_RealPostgres -v
func TestApplyBatchCheckin_RealPostgres_EventWideActionsFeed(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres actions-feed test (see doc comment for how to run it)")
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

	tenantID, eventID, staffUserID, attendeeID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	zoneID := uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	at := now.Add(-2 * time.Minute) // "offline scan two minutes ago", flushed now

	if _, err := pool.Exec(ctx,
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
		tenantID, "Actions Feed Test Tenant "+tenantID.String(), now,
	); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		// The event must go FIRST: deleting the tenant directly would
		// cascade into users, but attendees.checked_in_by references
		// users(id) with NO cascade action — a checked-in attendee (this
		// test's whole point) blocks the user delete until the event's
		// cascade has removed attendees/checkin_actions/batch_checkin_log.
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM events WHERE id = $1`, eventID); err != nil {
			t.Logf("cleanup: failed to delete event %s: %v", eventID, err)
		}
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup: failed to delete tenant %s: %v", tenantID, err)
		}
	})

	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'x', 'staff')`,
		staffUserID, tenantID, staffUserID.String()+"@actions-feed.test",
	); err != nil {
		t.Fatalf("insert staff user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		eventID, tenantID, "Actions Feed Test Event", now,
	); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	// One zone with NO stations: mobile check-ins must never attribute to
	// it — it pins the zones side of the invariant at 0.
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_zones (id, event_id, name, order_index, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
		zoneID, eventID, "Zone One", 1, now,
	); err != nil {
		t.Fatalf("insert zone: %v", err)
	}
	// email/company/position are non-NULL because ApplyBatchCheckin's
	// internal GetAttendeeByID scans them into plain strings (unlike the
	// monitor overview fixtures, which never read the attendee back
	// through that path).
	if _, err := pool.Exec(ctx,
		`INSERT INTO attendees (id, event_id, first_name, last_name, email, company, position, code, checkin_status, created_at, updated_at)
		 VALUES ($1, $2, 'A', 'One', $3, '', '', $4, false, $5, $5)`,
		attendeeID, eventID, attendeeID.String()+"@actions-feed.test", "CODE-"+uuid.New().String()[:8], now,
	); err != nil {
		t.Fatalf("insert attendee: %v", err)
	}

	firstClientUUID := uuid.New()
	item := &models.BatchCheckinItem{
		ClientUUID:   firstClientUUID,
		AttendeeID:   attendeeID,
		At:           at,
		DeviceNumber: 7,
		Kind:         "checkin",
	}
	outcome, err := s.ApplyBatchCheckin(ctx, eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if outcome != BatchCheckinCreated {
		t.Fatalf("outcome = %v, want BatchCheckinCreated", outcome)
	}

	// (a) Exactly one station-less 'checkin' row, created_at == item.At ==
	// the persisted checked_in_at (equality is the predicate contract).
	var gotCreatedAt time.Time
	var gotStation, gotStaff *uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT created_at, station_id, staff_user_id FROM checkin_actions WHERE event_id = $1 AND attendee_id = $2 AND action = 'checkin'`,
		eventID, attendeeID,
	).Scan(&gotCreatedAt, &gotStation, &gotStaff); err != nil {
		t.Fatalf("select action row: %v", err)
	}
	if !gotCreatedAt.Equal(at) {
		t.Errorf("action created_at = %v, want item.At %v", gotCreatedAt, at)
	}
	if gotStation != nil {
		t.Errorf("action station_id = %v, want NULL (no station provenance on the batch path)", gotStation)
	}
	if gotStaff == nil || *gotStaff != staffUserID {
		t.Errorf("action staff_user_id = %v, want %s", gotStaff, staffUserID)
	}
	var gotCheckedInAt time.Time
	if err := pool.QueryRow(ctx,
		`SELECT checked_in_at FROM attendees WHERE id = $1`, attendeeID,
	).Scan(&gotCheckedInAt); err != nil {
		t.Fatalf("select checked_in_at: %v", err)
	}
	if !gotCheckedInAt.Equal(gotCreatedAt) {
		t.Errorf("checked_in_at %v != action created_at %v — the current-period predicate's equality contract is broken", gotCheckedInAt, gotCreatedAt)
	}

	// (b) Rate window + minute buckets see the historical stamp.
	count, err := s.CountRecentCheckins(ctx, eventID, now.Add(-5*time.Minute))
	if err != nil {
		t.Fatalf("CountRecentCheckins: %v", err)
	}
	if count != 1 {
		t.Errorf("CountRecentCheckins = %d, want 1 (batch check-in inside the 5-minute window)", count)
	}
	buckets, err := s.GetMonitorMinuteBuckets(ctx, eventID, at.Add(-time.Minute))
	if err != nil {
		t.Fatalf("GetMonitorMinuteBuckets: %v", err)
	}
	wantMinute := at.Truncate(time.Minute)
	foundBucket := false
	for _, b := range buckets {
		if b.Minute.Equal(wantMinute) && b.Count == 1 {
			foundBucket = true
		}
	}
	if !foundBucket {
		t.Errorf("buckets = %+v, want one bucket at %v with count 1 (the scan's TRUE historical minute)", buckets, wantMinute)
	}

	// (c) The recent feed shows it.
	recent, err := s.GetCheckinActions(ctx, eventID, 20)
	if err != nil {
		t.Fatalf("GetCheckinActions: %v", err)
	}
	if len(recent) != 1 || recent[0].Action != "checkin" || recent[0].Attendee.ID != attendeeID {
		t.Errorf("GetCheckinActions = %+v, want exactly the one batch 'checkin' row for attendee %s", recent, attendeeID)
	}

	// (d) Overview: unattributed, invariant intact, zone untouched.
	total, checkedIn, zones, unattributed, err := s.GetMonitorOverview(ctx, eventID)
	if err != nil {
		t.Fatalf("GetMonitorOverview: %v", err)
	}
	if total != 1 || checkedIn != 1 {
		t.Errorf("total/checkedIn = %d/%d, want 1/1", total, checkedIn)
	}
	if unattributed != 1 {
		t.Errorf("unattributed = %d, want 1 (station-less rows never attribute)", unattributed)
	}
	zoneSum := 0
	for _, z := range zones {
		zoneSum += z.CheckedIn
	}
	if zoneSum != 0 {
		t.Errorf("sum(zones) = %d, want 0", zoneSum)
	}
	if zoneSum+unattributed != checkedIn {
		t.Errorf("invariant broken: sum(zones)+unattributed = %d, checked_in = %d", zoneSum+unattributed, checkedIn)
	}

	// Replay (same client_uuid) and a second device's retry (new
	// client_uuid, attendee already checked in) must add NO further rows.
	replayOutcome, err := s.ApplyBatchCheckin(ctx, eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("replay ApplyBatchCheckin: %v", err)
	}
	if replayOutcome != BatchCheckinDuplicateClientUUID {
		t.Fatalf("replay outcome = %v, want BatchCheckinDuplicateClientUUID", replayOutcome)
	}
	secondDevice := &models.BatchCheckinItem{
		ClientUUID:   uuid.New(),
		AttendeeID:   attendeeID,
		At:           now,
		DeviceNumber: 8,
		Kind:         "checkin",
	}
	retryOutcome, err := s.ApplyBatchCheckin(ctx, eventID, staffUserID, secondDevice)
	if err != nil {
		t.Fatalf("second-device ApplyBatchCheckin: %v", err)
	}
	if retryOutcome != BatchCheckinAlreadyCheckedIn {
		t.Fatalf("second-device outcome = %v, want BatchCheckinAlreadyCheckedIn", retryOutcome)
	}
	var actionCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM checkin_actions WHERE event_id = $1`, eventID,
	).Scan(&actionCount); err != nil {
		t.Fatalf("count actions: %v", err)
	}
	if actionCount != 1 {
		t.Errorf("checkin_actions rows = %d, want exactly 1 — replays/already-checked-in retries must not pollute the feed", actionCount)
	}
}
