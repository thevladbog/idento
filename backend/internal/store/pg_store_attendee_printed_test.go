package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// incrementAttendeePrintedCountSQL matches IncrementAttendeePrintedCount's
// exact UPDATE, including the `deleted_at IS NULL` guard
// (UpdateEventBadgeTemplate precedent — same race class): the caller's
// requireAttendeeOwnership pre-check can pass and a concurrent soft-delete
// land before this UPDATE executes; without the guard, an id-only UPDATE
// would still increment and 200 for a gone attendee.
const incrementAttendeePrintedCountSQL = `UPDATE attendees SET printed_count = printed_count \+ 1, updated_at = now\(\) WHERE id = \$1 AND deleted_at IS NULL RETURNING printed_count`

func TestIncrementAttendeePrintedCountReturnsBumpedCount(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID := uuid.New()
	mock.ExpectQuery(incrementAttendeePrintedCountSQL).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows([]string{"printed_count"}).AddRow(1))

	s := &PGStore{db: mock}
	newCount, err := s.IncrementAttendeePrintedCount(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("IncrementAttendeePrintedCount: %v", err)
	}
	if newCount != 1 {
		t.Errorf("newCount = %d, want 1", newCount)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestIncrementAttendeePrintedCountSequentialCallsAccumulate proves two
// successive calls against the same attendee row each bump from the
// PREVIOUS returned value (0 -> 1 -> 2), matching `printed_count +
// 1 ... RETURNING printed_count` semantics rather than some
// handler/store-side re-derivation.
func TestIncrementAttendeePrintedCountSequentialCallsAccumulate(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID := uuid.New()
	mock.ExpectQuery(incrementAttendeePrintedCountSQL).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows([]string{"printed_count"}).AddRow(1))
	mock.ExpectQuery(incrementAttendeePrintedCountSQL).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows([]string{"printed_count"}).AddRow(2))

	s := &PGStore{db: mock}

	first, err := s.IncrementAttendeePrintedCount(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if first != 1 {
		t.Errorf("first call newCount = %d, want 1", first)
	}

	second, err := s.IncrementAttendeePrintedCount(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if second != 2 {
		t.Errorf("second call newCount = %d, want 2", second)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestIncrementAttendeePrintedCountSoftDeleteRaceReturnsSentinel covers the
// ONLY reachable 0-row scenario: the attendee existed and passed the
// caller's requireAttendeeOwnership pre-check, then a concurrent DELETE
// /api/attendees/{id} set deleted_at before this UPDATE ran — so the
// `deleted_at IS NULL` guard matches 0 rows (the id itself is real; a
// nonexistent id can never get past the pre-check). The store must map
// pgx.ErrNoRows to the exported ErrAttendeeNotFound sentinel — never a
// fabricated count, never an opaque error — so the handler can render the
// house 404 masking instead of a 500.
func TestIncrementAttendeePrintedCountSoftDeleteRaceReturnsSentinel(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID := uuid.New() // a real attendee's id — soft-deleted mid-request
	mock.ExpectQuery(incrementAttendeePrintedCountSQL).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows([]string{"printed_count"})) // guard matched 0 rows

	s := &PGStore{db: mock}
	newCount, err := s.IncrementAttendeePrintedCount(context.Background(), attendeeID)
	if !errors.Is(err, ErrAttendeeNotFound) {
		t.Fatalf("err = %v, want ErrAttendeeNotFound", err)
	}
	if newCount != 0 {
		t.Errorf("newCount = %d, want 0 (no fabricated count on a missed guard)", newCount)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
