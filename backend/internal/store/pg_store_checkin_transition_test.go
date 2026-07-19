package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// These tests pin TransitionAttendeeCheckinStatus's exact guarded UPDATEs
// (PR #82 bot round: the legacy PUT / sync-push feed-row gate must be a
// database-arbitered transition, not a Go-level before/after compare —
// two concurrent requests could both observe the old status and both
// insert a duplicate checkin_actions feed row). The WHERE guard on the
// CURRENT status makes Postgres the sole arbiter of which request
// performed the flip, the same pattern as ApplyBatchCheckin's and
// CheckInAttendee's guarded UPDATEs.

func TestTransitionAttendeeCheckinStatus_CheckinFlipWins(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID, staffUserID := uuid.New(), uuid.New()
	at := time.Date(2026, 7, 19, 9, 30, 0, 0, time.UTC)

	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true, checked_in_at = \$2, checked_in_by = \$3, updated_at = now\(\)\s+WHERE id = \$1 AND checkin_status = false AND deleted_at IS NULL`).
		WithArgs(attendeeID, &at, &staffUserID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	s := &PGStore{db: mock}
	flipped, err := s.TransitionAttendeeCheckinStatus(context.Background(), attendeeID, true, &at, &staffUserID)
	if err != nil {
		t.Fatalf("TransitionAttendeeCheckinStatus: %v", err)
	}
	if !flipped {
		t.Fatal("flipped = false, want true when the guarded UPDATE affected 1 row")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestTransitionAttendeeCheckinStatus_CheckinAlreadyDoneReportsNoFlip is the
// race half: the guarded UPDATE affecting 0 rows (a concurrent request
// already flipped the attendee) must report flipped = false so the caller
// writes NO duplicate feed row.
func TestTransitionAttendeeCheckinStatus_CheckinAlreadyDoneReportsNoFlip(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID, staffUserID := uuid.New(), uuid.New()
	at := time.Date(2026, 7, 19, 9, 30, 0, 0, time.UTC)

	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(attendeeID, &at, &staffUserID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	s := &PGStore{db: mock}
	flipped, err := s.TransitionAttendeeCheckinStatus(context.Background(), attendeeID, true, &at, &staffUserID)
	if err != nil {
		t.Fatalf("TransitionAttendeeCheckinStatus: %v", err)
	}
	if flipped {
		t.Fatal("flipped = true, want false when the guarded UPDATE affected 0 rows")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestTransitionAttendeeCheckinStatus_UncheckClearsFields(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID := uuid.New()

	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = false, checked_in_at = NULL, checked_in_by = NULL, updated_at = now\(\)\s+WHERE id = \$1 AND checkin_status = true AND deleted_at IS NULL`).
		WithArgs(attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	s := &PGStore{db: mock}
	flipped, err := s.TransitionAttendeeCheckinStatus(context.Background(), attendeeID, false, nil, nil)
	if err != nil {
		t.Fatalf("TransitionAttendeeCheckinStatus: %v", err)
	}
	if !flipped {
		t.Fatal("flipped = false, want true when the guarded un-check affected 1 row")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
