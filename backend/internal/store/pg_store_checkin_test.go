package store

import (
	"context"
	"errors"
	"testing"
	"time"

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
