package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// incrementAttendeePrintedCountSQL matches IncrementAttendeePrintedCount's
// exact UPDATE. Deliberately id-only (no `deleted_at IS NULL` guard): the
// attendees table DOES soft-delete (see e.g. GetAttendeeByID's `WHERE id =
// $1 AND deleted_at IS NULL`), but by house contract the caller has already
// established existence/ownership/non-deletion via requireAttendeeOwnership
// (which routes through GetAttendeeByIDForTenant -> GetAttendeeByID) before
// ever calling this store method — the exact same id-only precedent as the
// pre-existing UpdateAttendee (pg_store.go: `UPDATE attendees SET ... WHERE
// id = $17`, no deleted_at guard either).
const incrementAttendeePrintedCountSQL = `UPDATE attendees SET printed_count = printed_count \+ 1, updated_at = now\(\) WHERE id = \$1 RETURNING printed_count`

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

// TestIncrementAttendeePrintedCountNoMatchingRowReturnsError covers the
// (extremely rare, TOCTOU-only) case where the row vanishes between the
// caller's requireAttendeeOwnership check and this UPDATE — the RETURNING
// clause matches 0 rows, QueryRow surfaces pgx.ErrNoRows, and this method
// must propagate a non-nil error rather than fabricating a count.
func TestIncrementAttendeePrintedCountNoMatchingRowReturnsError(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID := uuid.New()
	mock.ExpectQuery(incrementAttendeePrintedCountSQL).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows([]string{"printed_count"}))

	s := &PGStore{db: mock}
	if _, err := s.IncrementAttendeePrintedCount(context.Background(), attendeeID); err == nil {
		t.Fatal("want a non-nil error when no row matches, got nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
