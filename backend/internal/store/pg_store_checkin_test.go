package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

// upsertCheckinStationSQL matches UpsertCheckinStation's exact INSERT ...
// ON CONFLICT upsert (P4.1 Task 2).
const upsertCheckinStationSQL = `INSERT INTO checkin_stations \(event_id, name, zone_id\) VALUES \(\$1, \$2, \$3\) ON CONFLICT \(event_id, name\) DO UPDATE SET zone_id = EXCLUDED\.zone_id, last_seen_at = now\(\) RETURNING id, event_id, name, zone_id, last_seen_at, created_at`

// heartbeatCheckinStationSQL matches HeartbeatCheckinStation's exact
// guarded UPDATE (no RETURNING — the caller only needs RowsAffected).
const heartbeatCheckinStationSQL = `UPDATE checkin_stations SET last_seen_at = now\(\) WHERE id = \$1 AND event_id = \$2`

// listCheckinStationsSQL matches ListCheckinStations' exact SELECT.
const listCheckinStationsSQL = `SELECT id, event_id, name, zone_id, last_seen_at, created_at FROM checkin_stations WHERE event_id = \$1 ORDER BY name`

// TestUpsertCheckinStationFreshNameInserts proves a fresh (event_id, name)
// upsert issues the exact ON CONFLICT SQL, passes zoneID through as $3,
// and returns the RETURNING row scanned into a CheckinStation.
func TestUpsertCheckinStationFreshNameInserts(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	zoneID := uuid.New()
	stationID := uuid.New()
	now := time.Now()
	mock.ExpectQuery(upsertCheckinStationSQL).
		WithArgs(eventID, "Main Entrance", &zoneID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}).
			AddRow(stationID, eventID, "Main Entrance", &zoneID, now, now))

	s := &PGStore{db: mock}
	got, err := s.UpsertCheckinStation(context.Background(), eventID, "Main Entrance", &zoneID)
	if err != nil {
		t.Fatalf("UpsertCheckinStation: %v", err)
	}
	if got.ID != stationID {
		t.Errorf("ID = %v, want %v", got.ID, stationID)
	}
	if got.ZoneID == nil || *got.ZoneID != zoneID {
		t.Errorf("ZoneID = %v, want %v", got.ZoneID, zoneID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUpsertCheckinStationNilZoneIDInsertsNullZone proves a nil zoneID is
// passed through as a NULL (not, say, the zero-value UUID).
func TestUpsertCheckinStationNilZoneIDInsertsNullZone(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	stationID := uuid.New()
	now := time.Now()
	mock.ExpectQuery(upsertCheckinStationSQL).
		WithArgs(eventID, "Side Door", (*uuid.UUID)(nil)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}).
			AddRow(stationID, eventID, "Side Door", nil, now, now))

	s := &PGStore{db: mock}
	got, err := s.UpsertCheckinStation(context.Background(), eventID, "Side Door", nil)
	if err != nil {
		t.Fatalf("UpsertCheckinStation: %v", err)
	}
	if got.ZoneID != nil {
		t.Errorf("ZoneID = %v, want nil", got.ZoneID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUpsertCheckinStationRepeatNameSameIDZoneUpdated is the upsert proof:
// two successive calls with the SAME (event_id, name) but a DIFFERENT
// zone_id both hit the exact same ON CONFLICT SQL, and (per the mocked
// RETURNING rows, mirroring what the real constraint guarantees) the
// SAME station id comes back both times with zone_id replaced — never a
// second row.
func TestUpsertCheckinStationRepeatNameSameIDZoneUpdated(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	stationID := uuid.New()
	zoneA := uuid.New()
	zoneB := uuid.New()
	now := time.Now()

	mock.ExpectQuery(upsertCheckinStationSQL).
		WithArgs(eventID, "Main Entrance", &zoneA).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}).
			AddRow(stationID, eventID, "Main Entrance", &zoneA, now, now))
	mock.ExpectQuery(upsertCheckinStationSQL).
		WithArgs(eventID, "Main Entrance", &zoneB).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}).
			AddRow(stationID, eventID, "Main Entrance", &zoneB, now, now))

	s := &PGStore{db: mock}
	first, err := s.UpsertCheckinStation(context.Background(), eventID, "Main Entrance", &zoneA)
	if err != nil {
		t.Fatalf("first UpsertCheckinStation: %v", err)
	}
	second, err := s.UpsertCheckinStation(context.Background(), eventID, "Main Entrance", &zoneB)
	if err != nil {
		t.Fatalf("second UpsertCheckinStation: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("ids differ across upserts: first=%v second=%v (want same id)", first.ID, second.ID)
	}
	if second.ZoneID == nil || *second.ZoneID != zoneB {
		t.Fatalf("second.ZoneID = %v, want %v (zone updated)", second.ZoneID, zoneB)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestHeartbeatCheckinStationKnownRefreshesLastSeen proves the exact
// guarded UPDATE SQL and that a 1-row affect returns nil.
func TestHeartbeatCheckinStationKnownRefreshesLastSeen(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	stationID := uuid.New()
	mock.ExpectExec(heartbeatCheckinStationSQL).
		WithArgs(stationID, eventID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	s := &PGStore{db: mock}
	if err := s.HeartbeatCheckinStation(context.Background(), eventID, stationID); err != nil {
		t.Fatalf("HeartbeatCheckinStation: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestHeartbeatCheckinStationUnknownOrForeignReturnsSentinel covers the
// 0-row case (unknown station id, or an id belonging to a different
// event) — the store must map it to ErrCheckinStationNotFound, never a
// silent success.
func TestHeartbeatCheckinStationUnknownOrForeignReturnsSentinel(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	stationID := uuid.New()
	mock.ExpectExec(heartbeatCheckinStationSQL).
		WithArgs(stationID, eventID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	s := &PGStore{db: mock}
	err = s.HeartbeatCheckinStation(context.Background(), eventID, stationID)
	if !errors.Is(err, ErrCheckinStationNotFound) {
		t.Fatalf("err = %v, want ErrCheckinStationNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestListCheckinStationsReturnsRegistered proves the exact SELECT and
// that every registered row (including one with a NULL zone_id) is
// scanned back.
func TestListCheckinStationsReturnsRegistered(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	zoneID := uuid.New()
	now := time.Now()
	mock.ExpectQuery(listCheckinStationsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}).
			AddRow(uuid.New(), eventID, "Main Entrance", &zoneID, now, now).
			AddRow(uuid.New(), eventID, "Side Door", nil, now, now))

	s := &PGStore{db: mock}
	got, err := s.ListCheckinStations(context.Background(), eventID)
	if err != nil {
		t.Fatalf("ListCheckinStations: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2", len(got))
	}
	if got[0].ZoneID == nil || *got[0].ZoneID != zoneID {
		t.Errorf("got[0].ZoneID = %v, want %v", got[0].ZoneID, zoneID)
	}
	if got[1].ZoneID != nil {
		t.Errorf("got[1].ZoneID = %v, want nil", got[1].ZoneID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestListCheckinStationsNoneRegisteredReturnsEmpty proves an event with
// no stations yet gets a nil/empty slice, not an error.
// getCheckinStationByIDSQL matches GetCheckinStationByID's exact SELECT
// (P4.1 Task 3).
const getCheckinStationByIDSQL = `SELECT id, event_id, name, zone_id, last_seen_at, created_at FROM checkin_stations WHERE id = \$1`

func TestGetCheckinStationByIDFound(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	stationID := uuid.New()
	eventID := uuid.New()
	now := time.Now()
	mock.ExpectQuery(getCheckinStationByIDSQL).
		WithArgs(stationID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}).
			AddRow(stationID, eventID, "Main Entrance", nil, now, now))

	s := &PGStore{db: mock}
	got, err := s.GetCheckinStationByID(context.Background(), stationID)
	if err != nil {
		t.Fatalf("GetCheckinStationByID: %v", err)
	}
	if got.ID != stationID || got.EventID != eventID {
		t.Errorf("got=%+v, want id=%s event_id=%s", got, stationID, eventID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetCheckinStationByIDUnknownSurfacesRawErrNoRows proves an unknown id
// is NOT normalized to (nil, nil) — unlike GetCheckinSettings, this mirrors
// GetEventZoneByID's contract, which handlers rely on (see
// RegisterCheckinStation's "unknown zone" 400 branch) to distinguish
// "doesn't exist" from "found nil".
func TestGetCheckinStationByIDUnknownSurfacesRawErrNoRows(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	stationID := uuid.New()
	mock.ExpectQuery(getCheckinStationByIDSQL).
		WithArgs(stationID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}))

	s := &PGStore{db: mock}
	_, err = s.GetCheckinStationByID(context.Background(), stationID)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("err = %v, want pgx.ErrNoRows", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// checkinAttendeeReturningColumns is checkinAttendeeColumnsSQL's names, in
// scan order (no checked_in_by_email — see pg_store.go's doc on why).
var checkinAttendeeReturningColumns = []string{
	"id", "event_id", "first_name", "last_name", "email", "company", "position", "code",
	"checkin_status", "checked_in_at", "checked_in_by", "checked_in_device_number", "checked_in_point_name",
	"printed_count", "custom_fields", "blocked", "block_reason", "created_at", "updated_at",
}

// checkInAttendeeUpdateSQL matches CheckInAttendee's exact guarded UPDATE —
// including the `checkin_status = false` guard that makes this the
// zero-double-checkin write (P2.1 lesson: assert real SQL text, not a loose
// matcher).
const checkInAttendeeUpdateSQL = `UPDATE attendees\s+SET checkin_status = true, checked_in_at = now\(\), checked_in_by = \$1, checked_in_point_name = \$2, updated_at = now\(\)\s+WHERE id = \$3 AND event_id = \$4 AND checkin_status = false AND deleted_at IS NULL\s+RETURNING id, event_id, first_name, last_name, email, company, position, code, checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name, printed_count, custom_fields, blocked, block_reason, created_at, updated_at`

// checkInAttendeeFallbackSelectSQL matches the 0-row fallback SELECT — the
// same LEFT JOIN ... users shape as attendeeListColumnsSQL/scanAttendeeRow,
// scoped to one attendee id within eventID.
const checkInAttendeeFallbackSelectSQL = `SELECT\s+a\.id, a\.event_id, a\.first_name, a\.last_name, a\.email, a\.company, a\.position, a\.code,\s+a\.checkin_status, a\.checked_in_at, a\.checked_in_by, a\.checked_in_device_number, a\.checked_in_point_name, a\.printed_count, a\.custom_fields,\s+a\.blocked, a\.block_reason, a\.created_at, a\.updated_at,\s+u\.email as checked_in_by_email\s+FROM attendees a\s+LEFT JOIN users u ON a\.checked_in_by = u\.id\s+WHERE a\.id = \$1 AND a\.event_id = \$2 AND a\.deleted_at IS NULL`

// checkinActionsInsertCheckinSQL matches the feed row CheckInAttendee
// inserts on the "checked_in" outcome, in the SAME transaction.
const checkinActionsInsertCheckinSQL = `INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id\) VALUES \(\$1, \$2, \$3, 'checkin', \$4\)`

// TestCheckInAttendeeFreshAttendeeChecksInAndLogsFeedRow proves the exact
// guarded-UPDATE SQL, that a 1-row RETURNING result yields outcome
// "checked_in", that the returned attendee carries THIS call's
// staffEmail/stationName (checked_in_by_email has no column to read back
// from), and that a checkin_actions ('checkin') row is inserted in the
// SAME transaction before commit.
func TestCheckInAttendeeFreshAttendeeChecksInAndLogsFeedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, stationID, staffID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	stationName := "Main Entrance"

	mock.ExpectBegin()
	mock.ExpectQuery(checkInAttendeeUpdateSQL).
		WithArgs(staffID, &stationName, attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns).
			AddRow(attendeeID, eventID, "Ada", "Lovelace", "ada@example.com", "Acme", "Eng", "CODE1",
				true, &now, &staffID, nil, &stationName, 0, nil, false, nil, now, now))
	mock.ExpectExec(checkinActionsInsertCheckinSQL).
		WithArgs(eventID, attendeeID, &stationID, staffID).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	s := &PGStore{db: mock}
	outcome, a, err := s.CheckInAttendee(context.Background(), eventID, attendeeID, &stationID, staffID, "ada.staff@example.com", "Main Entrance")
	if err != nil {
		t.Fatalf("CheckInAttendee: %v", err)
	}
	if outcome != "checked_in" {
		t.Errorf("outcome = %q, want checked_in", outcome)
	}
	if a.CheckedInByEmail == nil || *a.CheckedInByEmail != "ada.staff@example.com" {
		t.Errorf("CheckedInByEmail = %v, want ada.staff@example.com", a.CheckedInByEmail)
	}
	if a.CheckedInPointName == nil || *a.CheckedInPointName != "Main Entrance" {
		t.Errorf("CheckedInPointName = %v, want Main Entrance", a.CheckedInPointName)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestCheckInAttendeeNoStationLeavesPointNameNull proves an empty
// stationName is passed through as NULL (not an empty string) — a
// station-less check-in (no station_id in the request).
func TestCheckInAttendeeNoStationLeavesPointNameNull(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffID := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery(checkInAttendeeUpdateSQL).
		WithArgs(staffID, (*string)(nil), attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns).
			AddRow(attendeeID, eventID, "Ada", "Lovelace", "ada@example.com", "Acme", "Eng", "CODE1",
				true, &now, &staffID, nil, nil, 0, nil, false, nil, now, now))
	mock.ExpectExec(checkinActionsInsertCheckinSQL).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), staffID).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	s := &PGStore{db: mock}
	outcome, a, err := s.CheckInAttendee(context.Background(), eventID, attendeeID, nil, staffID, "ada.staff@example.com", "")
	if err != nil {
		t.Fatalf("CheckInAttendee: %v", err)
	}
	if outcome != "checked_in" {
		t.Errorf("outcome = %q, want checked_in", outcome)
	}
	if a.CheckedInPointName != nil {
		t.Errorf("CheckedInPointName = %v, want nil", a.CheckedInPointName)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestCheckInAttendeeAlreadyCheckedInFallsBackNoFeedRow covers the 0-row
// path: the guarded UPDATE affects nothing (already checked in), so
// CheckInAttendee falls back to the joined SELECT and returns the
// EXISTING first-scan metadata — no checkin_actions row is inserted (no
// ExpectExec is set; an unexpected call would fail ExpectationsWereMet).
func TestCheckInAttendeeAlreadyCheckedInFallsBackNoFeedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffID := uuid.New(), uuid.New(), uuid.New()
	originalStaff := uuid.New()
	firstScan := time.Now().Add(-time.Hour)
	requestedStationName := "Side Door"
	originalPointName := "Main Entrance"
	originalEmail := "original.staff@example.com"

	mock.ExpectBegin()
	mock.ExpectQuery(checkInAttendeeUpdateSQL).
		WithArgs(staffID, &requestedStationName, attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns)) // 0 rows
	mock.ExpectQuery(checkInAttendeeFallbackSelectSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(attendeesByEventColumns).
			AddRow(attendeeID, eventID, "Ada", "Lovelace", "ada@example.com", "Acme", "Eng", "CODE1",
				true, &firstScan, &originalStaff, nil, &originalPointName, 0, nil, false, nil, firstScan, firstScan,
				&originalEmail))
	mock.ExpectCommit()

	s := &PGStore{db: mock}
	outcome, a, err := s.CheckInAttendee(context.Background(), eventID, attendeeID, nil, staffID, "second.staff@example.com", "Side Door")
	if err != nil {
		t.Fatalf("CheckInAttendee: %v", err)
	}
	if outcome != "already_checked_in" {
		t.Errorf("outcome = %q, want already_checked_in", outcome)
	}
	if a.CheckedInByEmail == nil || *a.CheckedInByEmail != "original.staff@example.com" {
		t.Errorf("CheckedInByEmail = %v, want the ORIGINAL scanner's email (original.staff@example.com), never overwritten", a.CheckedInByEmail)
	}
	if a.CheckedInPointName == nil || *a.CheckedInPointName != "Main Entrance" {
		t.Errorf("CheckedInPointName = %v, want the ORIGINAL Main Entrance, never overwritten by Side Door", a.CheckedInPointName)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestCheckInAttendeeMissingReturnsErrAttendeeNotFound covers the
// soft-delete-race / foreign-event 0-row-on-both-queries case: the guarded
// UPDATE and the fallback SELECT both match nothing, so the transaction
// rolls back (never commits) and the store surfaces ErrAttendeeNotFound.
func TestCheckInAttendeeMissingReturnsErrAttendeeNotFound(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffID := uuid.New(), uuid.New(), uuid.New()

	mock.ExpectBegin()
	mock.ExpectQuery(checkInAttendeeUpdateSQL).
		WithArgs(staffID, (*string)(nil), attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns))
	mock.ExpectQuery(checkInAttendeeFallbackSelectSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(attendeesByEventColumns))
	mock.ExpectRollback()

	s := &PGStore{db: mock}
	_, _, err = s.CheckInAttendee(context.Background(), eventID, attendeeID, nil, staffID, "staff@example.com", "")
	if !errors.Is(err, ErrAttendeeNotFound) {
		t.Fatalf("err = %v, want ErrAttendeeNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// undoCheckinUpdateSQL matches UndoCheckin's exact guarded UPDATE — guarded
// on checkin_status = true (the mirror-image guard of CheckInAttendee's
// checkin_status = false).
const undoCheckinUpdateSQL = `UPDATE attendees\s+SET checkin_status = false, checked_in_at = NULL, checked_in_by = NULL, checked_in_point_name = NULL, updated_at = now\(\)\s+WHERE id = \$1 AND event_id = \$2 AND checkin_status = true AND deleted_at IS NULL\s+RETURNING id, event_id, first_name, last_name, email, company, position, code, checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name, printed_count, custom_fields, blocked, block_reason, created_at, updated_at`

// undoCheckinFallbackSelectSQL matches the 0-row fallback SELECT (plain,
// non-joined — an undone/never-checked-in attendee has no email to show).
const undoCheckinFallbackSelectSQL = `SELECT id, event_id, first_name, last_name, email, company, position, code, checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name, printed_count, custom_fields, blocked, block_reason, created_at, updated_at FROM attendees WHERE id = \$1 AND event_id = \$2 AND deleted_at IS NULL`

// checkinActionsInsertUndoSQL matches the feed row UndoCheckin inserts on a
// genuine clear, in the SAME transaction.
const checkinActionsInsertUndoSQL = `INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id\) VALUES \(\$1, \$2, \$3, 'undo', \$4\)`

// TestUndoCheckinClearsAndLogsFeedRow proves the exact guarded-UPDATE SQL
// (checkin_status = true guard) and that a 1-row result inserts an 'undo'
// checkin_actions row in the same transaction before commit.
func TestUndoCheckinClearsAndLogsFeedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, stationID, staffID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery(undoCheckinUpdateSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns).
			AddRow(attendeeID, eventID, "Ada", "Lovelace", "ada@example.com", "Acme", "Eng", "CODE1",
				false, nil, nil, nil, nil, 0, nil, false, nil, now, now))
	mock.ExpectExec(checkinActionsInsertUndoSQL).
		WithArgs(eventID, attendeeID, &stationID, staffID).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	s := &PGStore{db: mock}
	a, err := s.UndoCheckin(context.Background(), eventID, attendeeID, &stationID, staffID)
	if err != nil {
		t.Fatalf("UndoCheckin: %v", err)
	}
	if a.CheckinStatus {
		t.Errorf("CheckinStatus = true, want false after undo")
	}
	if a.CheckedInAt != nil || a.CheckedInBy != nil || a.CheckedInPointName != nil {
		t.Errorf("undo left stale metadata: CheckedInAt=%v CheckedInBy=%v CheckedInPointName=%v", a.CheckedInAt, a.CheckedInBy, a.CheckedInPointName)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUndoCheckinAlreadyClearIsIdempotentNoFeedRow covers the 0-row path:
// the guarded UPDATE affects nothing (already not checked in), so
// UndoCheckin falls back to the plain SELECT and returns 200 with no feed
// row written (no ExpectExec is set for the checkin_actions INSERT).
func TestUndoCheckinAlreadyClearIsIdempotentNoFeedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffID := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()

	mock.ExpectBegin()
	mock.ExpectQuery(undoCheckinUpdateSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns)) // 0 rows
	mock.ExpectQuery(undoCheckinFallbackSelectSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns).
			AddRow(attendeeID, eventID, "Ada", "Lovelace", "ada@example.com", "Acme", "Eng", "CODE1",
				false, nil, nil, nil, nil, 0, nil, false, nil, now, now))
	mock.ExpectCommit()

	s := &PGStore{db: mock}
	a, err := s.UndoCheckin(context.Background(), eventID, attendeeID, nil, staffID)
	if err != nil {
		t.Fatalf("UndoCheckin: %v", err)
	}
	if a.CheckinStatus {
		t.Errorf("CheckinStatus = true, want false")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestUndoCheckinMissingReturnsErrAttendeeNotFound covers both queries
// matching nothing — the transaction rolls back and ErrAttendeeNotFound
// surfaces, the same soft-delete-race shape as CheckInAttendee's.
func TestUndoCheckinMissingReturnsErrAttendeeNotFound(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffID := uuid.New(), uuid.New(), uuid.New()

	mock.ExpectBegin()
	mock.ExpectQuery(undoCheckinUpdateSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns))
	mock.ExpectQuery(undoCheckinFallbackSelectSQL).
		WithArgs(attendeeID, eventID).
		WillReturnRows(pgxmock.NewRows(checkinAttendeeReturningColumns))
	mock.ExpectRollback()

	s := &PGStore{db: mock}
	_, err = s.UndoCheckin(context.Background(), eventID, attendeeID, nil, staffID)
	if !errors.Is(err, ErrAttendeeNotFound) {
		t.Fatalf("err = %v, want ErrAttendeeNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// getCheckinActionsSQL matches GetCheckinActions' exact joined SELECT.
const getCheckinActionsSQL = `SELECT ca\.id, ca\.action, ca\.station_id, ca\.created_at, a\.id, a\.first_name, a\.last_name, a\.code\s+FROM checkin_actions ca\s+JOIN attendees a ON ca\.attendee_id = a\.id\s+WHERE ca\.event_id = \$1\s+ORDER BY ca\.created_at DESC\s+LIMIT \$2`

// TestGetCheckinActionsReturnsNewestFirstJoinedRows proves the exact SQL
// (including LIMIT $2) and that rows scan into the joined
// CheckinActionRow/CheckinActionAttendee shape in whatever order the mock
// (standing in for the real ORDER BY created_at DESC) returns them.
func TestGetCheckinActionsReturnsNewestFirstJoinedRows(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	actionID1, actionID2 := uuid.New(), uuid.New()
	attendeeID1, attendeeID2 := uuid.New(), uuid.New()
	stationID := uuid.New()
	newer := time.Now()
	older := newer.Add(-time.Minute)

	mock.ExpectQuery(getCheckinActionsSQL).
		WithArgs(eventID, 50).
		WillReturnRows(pgxmock.NewRows([]string{"id", "action", "station_id", "created_at", "id", "first_name", "last_name", "code"}).
			AddRow(actionID1, "checkin", &stationID, newer, attendeeID1, "Ada", "Lovelace", "CODE1").
			AddRow(actionID2, "undo", nil, older, attendeeID2, "Bob", "Builder", "CODE2"))

	s := &PGStore{db: mock}
	got, err := s.GetCheckinActions(context.Background(), eventID, 50)
	if err != nil {
		t.Fatalf("GetCheckinActions: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2", len(got))
	}
	if got[0].ID != actionID1 || got[0].Action != "checkin" || got[0].StationID == nil || *got[0].StationID != stationID {
		t.Errorf("got[0] = %+v, unexpected", got[0])
	}
	if got[0].Attendee.ID != attendeeID1 || got[0].Attendee.FirstName != "Ada" || got[0].Attendee.Code != "CODE1" {
		t.Errorf("got[0].Attendee = %+v, unexpected", got[0].Attendee)
	}
	if got[1].StationID != nil {
		t.Errorf("got[1].StationID = %v, want nil (undo with no station)", got[1].StationID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetCheckinActionsNoneReturnsEmpty proves an event with no feed rows
// yet gets a nil/empty slice, not an error.
func TestGetCheckinActionsNoneReturnsEmpty(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getCheckinActionsSQL).
		WithArgs(eventID, 50).
		WillReturnRows(pgxmock.NewRows([]string{"id", "action", "station_id", "created_at", "id", "first_name", "last_name", "code"}))

	s := &PGStore{db: mock}
	got, err := s.GetCheckinActions(context.Background(), eventID, 50)
	if err != nil {
		t.Fatalf("GetCheckinActions: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("len(got) = %d, want 0", len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestListCheckinStationsNoneRegisteredReturnsEmpty(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(listCheckinStationsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "zone_id", "last_seen_at", "created_at"}))

	s := &PGStore{db: mock}
	got, err := s.ListCheckinStations(context.Background(), eventID)
	if err != nil {
		t.Fatalf("ListCheckinStations: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("len(got) = %d, want 0", len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
