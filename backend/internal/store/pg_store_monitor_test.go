package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// --- P4.2 Task 2: monitor snapshot aggregations ---

// getMonitorCountsSQL matches GetMonitorCounts' exact SELECT — ONE query
// for both total and checked-in counts, so the two numbers can never
// disagree the way two separately-issued queries against a live event
// could (a check-in landing between them).
const getMonitorCountsSQL = `SELECT COUNT\(\*\), COUNT\(\*\) FILTER \(WHERE checkin_status\) FROM attendees WHERE event_id = \$1 AND deleted_at IS NULL`

func TestGetMonitorCountsReturnsTotalsFromOneQuery(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getMonitorCountsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"count", "count"}).AddRow(42, 17))

	s := &PGStore{db: mock}
	total, checkedIn, err := s.GetMonitorCounts(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorCounts: %v", err)
	}
	if total != 42 || checkedIn != 17 {
		t.Errorf("total=%d checkedIn=%d, want 42, 17", total, checkedIn)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetMonitorCountsZeroAttendeeEventReturnsZeroZero proves a
// freshly-created event with no attendees at all reports (0, 0), not an
// error — COUNT(*) over an empty row set is 0, never NULL.
func TestGetMonitorCountsZeroAttendeeEventReturnsZeroZero(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getMonitorCountsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"count", "count"}).AddRow(0, 0))

	s := &PGStore{db: mock}
	total, checkedIn, err := s.GetMonitorCounts(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorCounts: %v", err)
	}
	if total != 0 || checkedIn != 0 {
		t.Errorf("total=%d checkedIn=%d, want 0, 0", total, checkedIn)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// getMonitorZonesSQL matches GetMonitorZones' exact single statement: a
// latest_checkin CTE (DISTINCT ON (ca.attendee_id) ... ORDER BY
// ca.attendee_id, ca.created_at DESC, ca.id DESC — the same id tie-breaker
// as GetCheckinActions, PR #77 bot-review round Finding E) feeding an
// attributed CTE (one row per currently-checked-in attendee, carrying its
// zone or NULL), which the final SELECT/UNION ALL turns into the
// zones-with-zero-count list (LEFT JOIN FROM event_zones) plus a single
// unattributed-count row (zone_id IS NULL) — so sum(zones)+unattributed ==
// checkedIn holds by construction: both come out of the SAME attributed CTE
// in the SAME statement.
const getMonitorZonesSQL = `WITH latest_checkin AS \(\s+SELECT DISTINCT ON \(ca\.attendee_id\) ca\.attendee_id, ca\.station_id\s+FROM checkin_actions ca\s+WHERE ca\.event_id = \$1 AND ca\.action = 'checkin'\s+ORDER BY ca\.attendee_id, ca\.created_at DESC, ca\.id DESC\s+\),\s+attributed AS \(\s+SELECT a\.id AS attendee_id, cs\.zone_id AS zone_id\s+FROM attendees a\s+LEFT JOIN latest_checkin lc ON lc\.attendee_id = a\.id\s+LEFT JOIN checkin_stations cs ON cs\.id = lc\.station_id\s+WHERE a\.event_id = \$1 AND a\.checkin_status = true AND a\.deleted_at IS NULL\s+\)\s+SELECT ez\.id AS zone_id, ez\.name, COUNT\(attributed\.attendee_id\) AS checked_in, ez\.order_index AS sort_key\s+FROM event_zones ez\s+LEFT JOIN attributed ON attributed\.zone_id = ez\.id\s+WHERE ez\.event_id = \$1\s+GROUP BY ez\.id, ez\.name, ez\.order_index\s+UNION ALL\s+SELECT NULL, NULL, COUNT\(\*\), NULL\s+FROM attributed\s+WHERE attributed\.zone_id IS NULL\s+ORDER BY sort_key NULLS LAST`

// TestGetMonitorZonesIncludesZeroCountZonesAndUnattributed proves the exact
// SQL and the scanning discriminator: a row with a non-nil zone_id is a
// MonitorZoneCount (including a zero-count zone, which must still appear in
// the slice — LEFT JOIN FROM event_zones, not the other way around), and
// the single row with a nil zone_id/name is the unattributed count — the
// row a checked-in attendee with no matching 'checkin' action row falls
// into. Also proves the load-bearing invariant sum(zones)+unattributed ==
// checkedIn on this fixture.
func TestGetMonitorZonesIncludesZeroCountZonesAndUnattributed(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	zoneA := uuid.New()
	zoneB := uuid.New()
	zoneEmpty := uuid.New()

	mock.ExpectQuery(getMonitorZonesSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"zone_id", "name", "checked_in", "sort_key"}).
			AddRow(&zoneB, strPtr("Zone B"), 1, intPtr(1)).
			AddRow(&zoneA, strPtr("Zone A"), 2, intPtr(2)).
			AddRow(&zoneEmpty, strPtr("Zone Empty"), 0, intPtr(3)).
			AddRow((*uuid.UUID)(nil), (*string)(nil), 1, (*int)(nil)))

	s := &PGStore{db: mock}
	zones, unattributed, err := s.GetMonitorZones(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorZones: %v", err)
	}
	if len(zones) != 3 {
		t.Fatalf("len(zones) = %d, want 3", len(zones))
	}
	if zones[0].ZoneID != zoneB || zones[0].Name != "Zone B" || zones[0].CheckedIn != 1 {
		t.Errorf("zones[0] = %+v, unexpected", zones[0])
	}
	if zones[2].ZoneID != zoneEmpty || zones[2].CheckedIn != 0 {
		t.Errorf("zones[2] (zero-count zone) = %+v, want CheckedIn=0", zones[2])
	}
	if unattributed != 1 {
		t.Errorf("unattributed = %d, want 1", unattributed)
	}

	sum := 0
	for _, z := range zones {
		sum += z.CheckedIn
	}
	const checkedIn = 4 // must match this fixture's total checked-in population
	if sum+unattributed != checkedIn {
		t.Errorf("sum(zones)+unattributed = %d, want %d (invariant broken)", sum+unattributed, checkedIn)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetMonitorZonesNoZonesOnlyUnattributedRow proves an event with zero
// zones still gets exactly the unattributed row back (COUNT(*) over an
// aggregate with no GROUP BY always returns one row, even 0) rather than an
// empty/error result.
func TestGetMonitorZonesNoZonesOnlyUnattributedRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getMonitorZonesSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"zone_id", "name", "checked_in", "sort_key"}).
			AddRow((*uuid.UUID)(nil), (*string)(nil), 0, (*int)(nil)))

	s := &PGStore{db: mock}
	zones, unattributed, err := s.GetMonitorZones(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorZones: %v", err)
	}
	if len(zones) != 0 {
		t.Errorf("len(zones) = %d, want 0", len(zones))
	}
	if unattributed != 0 {
		t.Errorf("unattributed = %d, want 0", unattributed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// getMonitorMinuteBucketsSQL matches GetMonitorMinuteBuckets' exact SELECT
// — date_trunc('minute', created_at) GROUP BY, restricted to 'checkin'
// actions at/after $2, ascending.
const getMonitorMinuteBucketsSQL = `SELECT date_trunc\('minute', created_at\) AS minute, COUNT\(\*\)\s+FROM checkin_actions\s+WHERE event_id = \$1 AND action = 'checkin' AND created_at >= \$2\s+GROUP BY minute\s+ORDER BY minute ASC`

func TestGetMonitorMinuteBucketsReturnsAscendingBuckets(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	since := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	m1 := time.Date(2026, 7, 18, 9, 30, 0, 0, time.UTC)
	m2 := time.Date(2026, 7, 18, 9, 31, 0, 0, time.UTC)

	mock.ExpectQuery(getMonitorMinuteBucketsSQL).
		WithArgs(eventID, since).
		WillReturnRows(pgxmock.NewRows([]string{"minute", "count"}).
			AddRow(m1, 3).
			AddRow(m2, 5))

	s := &PGStore{db: mock}
	got, err := s.GetMonitorMinuteBuckets(context.Background(), eventID, since)
	if err != nil {
		t.Fatalf("GetMonitorMinuteBuckets: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2", len(got))
	}
	if !got[0].Minute.Equal(m1) || got[0].Count != 3 {
		t.Errorf("got[0] = %+v, unexpected", got[0])
	}
	if !got[1].Minute.Equal(m2) || got[1].Count != 5 {
		t.Errorf("got[1] = %+v, unexpected", got[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetMonitorMinuteBucketsNoneReturnsEmpty proves an event with no
// 'checkin' actions since the cutoff gets a nil/empty slice, not an error.
func TestGetMonitorMinuteBucketsNoneReturnsEmpty(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	since := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(getMonitorMinuteBucketsSQL).
		WithArgs(eventID, since).
		WillReturnRows(pgxmock.NewRows([]string{"minute", "count"}))

	s := &PGStore{db: mock}
	got, err := s.GetMonitorMinuteBuckets(context.Background(), eventID, since)
	if err != nil {
		t.Fatalf("GetMonitorMinuteBuckets: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("len(got) = %d, want 0", len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// getMonitorStationsSQL matches GetMonitorStations' exact SELECT — a
// per-station 'checkin'-action count via FILTER (so 'undo'/'reprint' rows
// sharing the same station_id don't inflate it), ordered by name.
const getMonitorStationsSQL = `SELECT cs\.id, cs\.name, cs\.zone_id, cs\.last_seen_at, COUNT\(ca\.id\) FILTER \(WHERE ca\.action = 'checkin'\)\s+FROM checkin_stations cs\s+LEFT JOIN checkin_actions ca ON ca\.station_id = cs\.id\s+WHERE cs\.event_id = \$1\s+GROUP BY cs\.id, cs\.name, cs\.zone_id, cs\.last_seen_at\s+ORDER BY cs\.name`

func TestGetMonitorStationsReturnsNameOrderedWithCounts(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	stationA := uuid.New()
	stationB := uuid.New()
	zoneID := uuid.New()
	lastSeenA := time.Now().Add(-10 * time.Second)
	lastSeenB := time.Now().Add(-90 * time.Second)

	mock.ExpectQuery(getMonitorStationsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "zone_id", "last_seen_at", "count"}).
			AddRow(stationA, "Station A", &zoneID, lastSeenA, 7).
			AddRow(stationB, "Station B (no zone, no scans)", (*uuid.UUID)(nil), lastSeenB, 0))

	s := &PGStore{db: mock}
	got, err := s.GetMonitorStations(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorStations: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len(got) = %d, want 2", len(got))
	}
	if got[0].ID != stationA || got[0].Name != "Station A" || got[0].ZoneID == nil || *got[0].ZoneID != zoneID || got[0].CheckinCount != 7 {
		t.Errorf("got[0] = %+v, unexpected", got[0])
	}
	if got[1].ID != stationB || got[1].ZoneID != nil || got[1].CheckinCount != 0 {
		t.Errorf("got[1] = %+v, unexpected", got[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetMonitorStationsNoneRegisteredReturnsEmpty proves an event with no
// check-in stations registered gets a nil/empty slice, not an error.
func TestGetMonitorStationsNoneRegisteredReturnsEmpty(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getMonitorStationsSQL).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "zone_id", "last_seen_at", "count"}))

	s := &PGStore{db: mock}
	got, err := s.GetMonitorStations(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorStations: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("len(got) = %d, want 0", len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func intPtr(n int) *int { return &n }
