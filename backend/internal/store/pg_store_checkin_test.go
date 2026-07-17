package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// getCheckinSettingsSQL matches GetCheckinSettings' exact SELECT.
const getCheckinSettingsSQL = `SELECT checkin_settings FROM events WHERE id = \$1 AND deleted_at IS NULL`

// updateCheckinSettingsSQL matches UpdateCheckinSettings' exact UPDATE,
// including the `deleted_at IS NULL` guard (UpdateEventBadgeTemplate /
// IncrementAttendeePrintedCount precedent — same race class): the caller's
// requireEventOwnership pre-check can pass and a concurrent soft-delete
// land before this UPDATE executes.
const updateCheckinSettingsSQL = `UPDATE events SET checkin_settings = \$1, updated_at = now\(\) WHERE id = \$2 AND deleted_at IS NULL`

func TestGetCheckinSettingsReturnsStoredJSON(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	stored := []byte(`{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}`)
	mock.ExpectQuery(getCheckinSettingsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"checkin_settings"}).AddRow(stored))

	s := &PGStore{db: mock}
	got, err := s.GetCheckinSettings(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetCheckinSettings: %v", err)
	}
	if string(got) != string(stored) {
		t.Errorf("got=%s, want=%s", got, stored)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetCheckinSettingsNullColumnReturnsNilNil covers the "no settings
// saved yet" case: the column exists but is NULL for this event. The scan
// destination receives a nil/empty byte slice; GetCheckinSettings must
// collapse that to (nil, nil) rather than fabricating an empty object.
func TestGetCheckinSettingsNullColumnReturnsNilNil(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getCheckinSettingsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"checkin_settings"}).AddRow([]byte(nil)))

	s := &PGStore{db: mock}
	got, err := s.GetCheckinSettings(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetCheckinSettings: %v", err)
	}
	if got != nil {
		t.Errorf("got=%s, want nil", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetCheckinSettingsNoRowsReturnsNilNil covers "no matching,
// non-deleted event" — the SELECT's deleted_at IS NULL guard misses (or
// the id doesn't exist at all), so QueryRow surfaces pgx.ErrNoRows.
// GetCheckinSettings must map that to (nil, nil), the same not-found idiom
// as GetEventBadgeTemplate, never surfacing the raw pgx error.
func TestGetCheckinSettingsNoRowsReturnsNilNil(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getCheckinSettingsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"checkin_settings"})) // no row

	s := &PGStore{db: mock}
	got, err := s.GetCheckinSettings(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetCheckinSettings: %v", err)
	}
	if got != nil {
		t.Errorf("got=%s, want nil", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUpdateCheckinSettingsIssuesGuardedUpdate proves the exact SQL text
// (P2.1 lesson: pgxmock tests must assert real SQL, not a loose matcher)
// and that the raw settings bytes are passed through verbatim as $1.
func TestUpdateCheckinSettingsIssuesGuardedUpdate(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	settings := []byte(`{"print_on_checkin":true,"verdict_auto_dismiss_sec":5,"scan_input":"wedge","manual_search_enabled":false}`)
	mock.ExpectExec(updateCheckinSettingsSQL).
		WithArgs(settings, eventID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	s := &PGStore{db: mock}
	if err := s.UpdateCheckinSettings(context.Background(), eventID, settings); err != nil {
		t.Fatalf("UpdateCheckinSettings: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUpdateCheckinSettingsSoftDeleteRaceIsSilentNoOp covers the 0-row
// case (the caller's requireEventOwnership pre-check passed, then a
// concurrent soft-delete landed before this UPDATE ran). Unlike
// UpdateEventBadgeTemplate/IncrementAttendeePrintedCount, there is no
// RETURNING clause and no sentinel error here — Exec succeeds regardless
// of rows affected, so this is a silent no-op (the same idiom as
// SoftDeleteEvent), never a fabricated error.
func TestUpdateCheckinSettingsSoftDeleteRaceIsSilentNoOp(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New() // a real event's id — soft-deleted mid-request
	settings := []byte(`{"print_on_checkin":false,"verdict_auto_dismiss_sec":10,"scan_input":"manual","manual_search_enabled":true}`)
	mock.ExpectExec(updateCheckinSettingsSQL).
		WithArgs(settings, eventID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	s := &PGStore{db: mock}
	if err := s.UpdateCheckinSettings(context.Background(), eventID, settings); err != nil {
		t.Fatalf("UpdateCheckinSettings: %v (want nil — silent no-op)", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
