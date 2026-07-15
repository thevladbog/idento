package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// GetAttendeesPage shares attendeesByEventColumns (pg_store_attendees_test.go)
// for row shape — it selects the exact same columns as GetAttendeesByEventID.

// (a) No filters: COUNT(*) and the page SELECT both run against the plain
// event_id/deleted_at WHERE, with LIMIT/OFFSET appended as the last two args.
func TestGetAttendeesPage_NoFiltersPaginates(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	id1, id2 := uuid.New(), uuid.New()
	now := time.Now()

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM attendees a\s+WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL`).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(2))

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, id1, eventID, "Alice", "Anderson", "alice@example.com", "CODE-A", now)
	addAttendeeRow(rows, id2, eventID, "Bob", "Baker", "bob@example.com", "CODE-B", now)

	mock.ExpectQuery(`FROM attendees a\s+LEFT JOIN users u ON a\.checked_in_by = u\.id\s+WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL\s+ORDER BY a\.last_name, a\.first_name, a\.id\s+LIMIT \$2 OFFSET \$3`).
		WithArgs(eventID, 2, 0).
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, total, err := s.GetAttendeesPage(context.Background(), eventID, AttendeeFilter{Page: 1, PerPage: 2})
	if err != nil {
		t.Fatalf("GetAttendeesPage: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	if len(attendees) != 2 {
		t.Fatalf("len(attendees) = %d, want 2", len(attendees))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (b) Page 2 computes the correct OFFSET (page-1)*perPage.
func TestGetAttendeesPage_SecondPageComputesOffset(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	id3 := uuid.New()
	now := time.Now()

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM attendees a`).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(5))

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, id3, eventID, "Carl", "Carter", "carl@example.com", "CODE-C", now)

	mock.ExpectQuery(`LIMIT \$2 OFFSET \$3`).
		WithArgs(eventID, 2, 2). // page=2, per_page=2 -> offset (2-1)*2 = 2
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, total, err := s.GetAttendeesPage(context.Background(), eventID, AttendeeFilter{Page: 2, PerPage: 2})
	if err != nil {
		t.Fatalf("GetAttendeesPage: %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	if len(attendees) != 1 || attendees[0].ID != id3 {
		t.Fatalf("got %+v, want exactly id3", attendees)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (c) Status filter appends "a.checkin_status = $N" ahead of LIMIT/OFFSET,
// and the COUNT query carries the same filter.
func TestGetAttendeesPage_StatusFilter(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	id1 := uuid.New()
	now := time.Now()
	checkedIn := true

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM attendees a\s+WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL AND a\.checkin_status = \$2`).
		WithArgs(eventID, true).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, id1, eventID, "Dana", "Diaz", "dana@example.com", "CODE-D", now)

	mock.ExpectQuery(`WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL AND a\.checkin_status = \$2\s+ORDER BY a\.last_name, a\.first_name, a\.id\s+LIMIT \$3 OFFSET \$4`).
		WithArgs(eventID, true, 50, 0).
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, total, err := s.GetAttendeesPage(context.Background(), eventID, AttendeeFilter{Status: &checkedIn, Page: 1, PerPage: 50})
	if err != nil {
		t.Fatalf("GetAttendeesPage: %v", err)
	}
	if total != 1 || len(attendees) != 1 {
		t.Fatalf("got total=%d len=%d, want 1/1", total, len(attendees))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (d) Zone filter inner-joins attendee_zone_access on attendee_id/zone_id/allowed=true,
// with the zone UUID bound as $2 ahead of any code/search/status args, and
// LIMIT/OFFSET as the trailing args in both the COUNT and page query.
func TestGetAttendeesPage_ZoneFilterJoinsAttendeeZoneAccess(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	zoneID := uuid.New()
	id1 := uuid.New()
	now := time.Now()

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM attendees a JOIN attendee_zone_access aza ON aza\.attendee_id = a\.id AND aza\.zone_id = \$2 AND aza\.allowed = true\s+WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL`).
		WithArgs(eventID, zoneID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, id1, eventID, "Eve", "Evans", "eve@example.com", "CODE-E", now)

	mock.ExpectQuery(`JOIN attendee_zone_access aza ON aza\.attendee_id = a\.id AND aza\.zone_id = \$2 AND aza\.allowed = true\s+WHERE a\.event_id = \$1 AND a\.deleted_at IS NULL\s+ORDER BY a\.last_name, a\.first_name, a\.id\s+LIMIT \$3 OFFSET \$4`).
		WithArgs(eventID, zoneID, 50, 0).
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, total, err := s.GetAttendeesPage(context.Background(), eventID, AttendeeFilter{ZoneID: &zoneID, Page: 1, PerPage: 50})
	if err != nil {
		t.Fatalf("GetAttendeesPage: %v", err)
	}
	if total != 1 || len(attendees) != 1 {
		t.Fatalf("got total=%d len=%d, want 1/1", total, len(attendees))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// (e) Filters compose: zone + status + search all appear together with args
// bound in join-then-WHERE order, ahead of LIMIT/OFFSET.
func TestGetAttendeesPage_FiltersCompose(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	zoneID := uuid.New()
	id1 := uuid.New()
	now := time.Now()
	checkedIn := true

	mock.ExpectQuery(`SELECT COUNT\(\*\)`).
		WithArgs(eventID, zoneID, "%jane%", true).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))

	rows := pgxmock.NewRows(attendeesByEventColumns)
	addAttendeeRow(rows, id1, eventID, "Jane", "Doe", "jane@example.com", "CODE-JANE", now)

	mock.ExpectQuery(`a\.first_name ILIKE \$3 ESCAPE '\\' OR a\.last_name ILIKE \$3 ESCAPE '\\' OR a\.email ILIKE \$3 ESCAPE '\\' OR a\.code ILIKE \$3 ESCAPE '\\'.*AND a\.checkin_status = \$4`).
		WithArgs(eventID, zoneID, "%jane%", true, 50, 0).
		WillReturnRows(rows)

	s := &PGStore{db: mock}
	attendees, total, err := s.GetAttendeesPage(context.Background(), eventID, AttendeeFilter{
		Search: "jane", ZoneID: &zoneID, Status: &checkedIn, Page: 1, PerPage: 50,
	})
	if err != nil {
		t.Fatalf("GetAttendeesPage: %v", err)
	}
	if total != 1 || len(attendees) != 1 {
		t.Fatalf("got total=%d len=%d, want 1/1", total, len(attendees))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
