package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// attendeesByEventColumns mirrors the column list GetAttendeesByEventID
// selects (including the LEFT JOINed checked_in_by_email), in scan order.
var attendeesByEventColumns = []string{
	"id", "event_id", "first_name", "last_name", "email", "company", "position", "code",
	"checkin_status", "checked_in_at", "checked_in_by", "checked_in_device_number", "checked_in_point_name",
	"printed_count", "custom_fields", "blocked", "block_reason", "created_at", "updated_at",
	"checked_in_by_email",
}

// addAttendeeRow appends one attendee row with the given identity fields and
// zero/nil values for everything else, matching attendeesByEventColumns.
func addAttendeeRow(rows *pgxmock.Rows, id, eventID uuid.UUID, firstName, lastName, email, code string, now time.Time) *pgxmock.Rows {
	return rows.AddRow(
		id, eventID, firstName, lastName, email, "Acme", "Eng", code,
		false, nil, nil, nil, nil,
		0, nil, false, nil, now, now,
		nil,
	)
}

// GetAttendeesByEventID used to ignore its code/search params entirely and
// always return the full attendee list (this was the bug: mobile QR/barcode
// check-in resolved to whichever attendee sorted first alphabetically,
// regardless of what was scanned). These tests pin the fixed behavior at the
// store layer using the pgxmock harness established in
// pg_store_batch_test.go / pg_store_register_test.go.

// (a) An exact `code` match returns only the one matching attendee, even when
// other attendees exist in the same event.
func TestGetAttendeesByEventID_CodeFilterReturnsExactMatch(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	attendeeID := uuid.New()
	now := time.Now()

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, attendeeID, eventID, "Jane", "Doe", "jane@example.com", "CODE-JANE", now)

	mock.ExpectQuery(`FROM attendees a`).
		WithArgs(eventID, "CODE-JANE").
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, err := s.GetAttendeesByEventID(context.Background(), eventID, "CODE-JANE", "")
	if err != nil {
		t.Fatalf("GetAttendeesByEventID: %v", err)
	}
	if len(attendees) != 1 {
		t.Fatalf("len(attendees) = %d, want 1", len(attendees))
	}
	if attendees[0].ID != attendeeID || attendees[0].Code != "CODE-JANE" {
		t.Fatalf("got attendee %+v, want id=%s code=CODE-JANE", attendees[0], attendeeID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (b) A `search` filter returns only attendees matching the substring,
// case-insensitively, across first/last name, email, and code.
func TestGetAttendeesByEventID_SearchFilterReturnsPartialCaseInsensitiveMatches(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	matchID := uuid.New()
	now := time.Now()

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, matchID, eventID, "Jane", "Doe", "jane@example.com", "CODE-JANE", now)

	mock.ExpectQuery(`a\.first_name ILIKE \$2 OR a\.last_name ILIKE \$2 OR a\.email ILIKE \$2 OR a\.code ILIKE \$2`).
		WithArgs(eventID, "%jane%").
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, err := s.GetAttendeesByEventID(context.Background(), eventID, "", "jane")
	if err != nil {
		t.Fatalf("GetAttendeesByEventID: %v", err)
	}
	if len(attendees) != 1 {
		t.Fatalf("len(attendees) = %d, want 1", len(attendees))
	}
	if attendees[0].ID != matchID {
		t.Fatalf("got attendee id %s, want %s", attendees[0].ID, matchID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (b2) A `search` value containing ILIKE's own wildcard characters (% and _)
// is escaped before being sent, so e.g. "jane_doe" only matches a literal
// underscore rather than ILIKE's "any one character" wildcard.
func TestGetAttendeesByEventID_SearchFilterEscapesIlikeWildcards(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	matchID := uuid.New()
	now := time.Now()

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, matchID, eventID, "Jane", "Doe", "jane_doe@example.com", "CODE-JANE", now)

	mock.ExpectQuery(`ILIKE \$2.*ESCAPE '\\'`).
		WithArgs(eventID, `%jane\_doe%`).
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, err := s.GetAttendeesByEventID(context.Background(), eventID, "", "jane_doe")
	if err != nil {
		t.Fatalf("GetAttendeesByEventID: %v", err)
	}
	if len(attendees) != 1 || attendees[0].ID != matchID {
		t.Fatalf("got %+v, want exactly matchID %s", attendees, matchID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (c) No filters (both "") returns everyone, unchanged from today's
// (pre-fix) behavior — args must be exactly [eventID], no extra placeholders.
func TestGetAttendeesByEventID_NoFiltersReturnsEveryone(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	id1, id2 := uuid.New(), uuid.New()
	now := time.Now()

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, id1, eventID, "Alice", "Anderson", "alice@example.com", "CODE-A", now)
	addAttendeeRow(rows, id2, eventID, "Bob", "Baker", "bob@example.com", "CODE-B", now)

	mock.ExpectQuery(`FROM attendees a`).
		WithArgs(eventID). // exactly one arg: no code/search placeholders added
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, err := s.GetAttendeesByEventID(context.Background(), eventID, "", "")
	if err != nil {
		t.Fatalf("GetAttendeesByEventID: %v", err)
	}
	if len(attendees) != 2 {
		t.Fatalf("len(attendees) = %d, want 2 (unfiltered)", len(attendees))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (d) Tenant/event isolation is preserved: the event_id ($1) clause must
// still be present and bound to the queried event even when code/search
// filters are combined — a filter must never let an attendee from a
// different event leak through.
func TestGetAttendeesByEventID_EventIsolationPreservedWithFilters(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	attendeeID := uuid.New()
	now := time.Now()

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, attendeeID, eventID, "Jane", "Doe", "jane@example.com", "CODE-JANE", now)

	// The mandatory event/deleted_at clause must remain intact and bound as
	// $1, ahead of the appended code ($2) and search ($3) filters.
	mock.ExpectQuery(`WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL AND a\.code = \$2 AND \(a\.first_name ILIKE \$3`).
		WithArgs(eventID, "CODE-JANE", "%jane%").
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, err := s.GetAttendeesByEventID(context.Background(), eventID, "CODE-JANE", "jane")
	if err != nil {
		t.Fatalf("GetAttendeesByEventID: %v", err)
	}
	if len(attendees) != 1 || attendees[0].EventID != eventID {
		t.Fatalf("got %+v, want exactly one attendee scoped to event %s", attendees, eventID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
