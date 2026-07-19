package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// checkinActionsInsertAtSQLPattern pins InsertCheckinActionAt's exact
// statement (2026-07-19 event-wide actions-feed design): identical to
// checkinActionInsertSQL except created_at is an explicit bind with a
// COALESCE($6, now()) fallback, and staff_user_id is bound as a nullable
// pointer. The original statement is deliberately NOT reused/extended —
// its byte-for-byte text is a P4.1 pgxmock contract, and its DEFAULT
// now() is load-bearing for the station path's transaction-stable
// checked_in_at == created_at equality.
const checkinActionsInsertAtSQLPattern = `INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id, created_at\) VALUES \(\$1, \$2, \$3, \$4, \$5, COALESCE\(\$6, now\(\)\)\)`

// TestInsertCheckinActionAt_ExplicitTimestamp proves the batch/legacy-path
// contract: a non-nil `at` is bound verbatim as $6 — the caller passes the
// exact value it persisted into attendees.checked_in_at, so the monitor's
// current-period predicate (ca.created_at >= a.checked_in_at) holds by
// equality with zero clock dependence.
func TestInsertCheckinActionAt_ExplicitTimestamp(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffUserID := uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 7, 19, 9, 30, 0, 0, time.UTC)

	mock.ExpectExec(checkinActionsInsertAtSQLPattern).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "checkin", &staffUserID, &at).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	if err := s.InsertCheckinActionAt(context.Background(), eventID, attendeeID, "checkin", nil, &staffUserID, &at); err != nil {
		t.Fatalf("InsertCheckinActionAt: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestInsertCheckinActionAt_NilOptionalsFallBackToDefaults proves nil
// staff/at bind as SQL NULLs — COALESCE($6, now()) then stamps server time
// (the handler 'undo' rows' contract), and staff_user_id stays NULL for
// callers without a resolvable user.
func TestInsertCheckinActionAt_NilOptionalsFallBackToDefaults(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID := uuid.New(), uuid.New()

	mock.ExpectExec(checkinActionsInsertAtSQLPattern).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "undo", (*uuid.UUID)(nil), (*time.Time)(nil)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	if err := s.InsertCheckinActionAt(context.Background(), eventID, attendeeID, "undo", nil, nil, nil); err != nil {
		t.Fatalf("InsertCheckinActionAt: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
