package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// --- P4.2 Task 2 / PR #81 bot-review round Findings A1+A2: monitor
// snapshot aggregations ---

// getMonitorOverviewSQL matches GetMonitorOverview's exact single
// statement (PR #81 bot-review round, Finding A1 merges the former
// GetMonitorCounts + GetMonitorZones into one query so total/checked_in
// can never transiently disagree with zones/unattributed): a counts CTE
// (total + checked_in from one attendees scan), a latest_state CTE
// (DISTINCT ON (ca.attendee_id) over 'checkin'/'undo' actions — Finding
// A2: including 'undo' so a later undo supersedes an earlier checkin's
// attribution — ORDER BY ca.attendee_id, ca.created_at DESC, ca.id DESC,
// the same id tie-breaker as GetCheckinActions, PR #77 bot-review round
// Finding E), an attributed CTE (one row per currently-checked-in
// attendee, joined to checkin_stations ONLY when the latest state-changing
// action is 'checkin'), and a final 3-branch UNION ALL (zone rows,
// the unattributed row, the totals row) discriminated by a leading
// row_kind column — so sum(zone rows)+unattributed == checked_in holds by
// construction: all four numbers come out of the SAME statement's
// snapshot.
const getMonitorOverviewSQL = `WITH counts AS \(\s+SELECT COUNT\(\*\) AS total, COUNT\(\*\) FILTER \(WHERE checkin_status\) AS checked_in\s+FROM attendees\s+WHERE event_id = \$1 AND deleted_at IS NULL\s+\),\s+latest_state AS \(\s+SELECT DISTINCT ON \(ca\.attendee_id\) ca\.attendee_id, ca\.action, ca\.station_id\s+FROM checkin_actions ca\s+WHERE ca\.event_id = \$1 AND ca\.action IN \('checkin', 'undo'\)\s+ORDER BY ca\.attendee_id, ca\.created_at DESC, ca\.id DESC\s+\),\s+attributed AS \(\s+SELECT a\.id AS attendee_id, cs\.zone_id AS zone_id\s+FROM attendees a\s+LEFT JOIN latest_state ls ON ls\.attendee_id = a\.id\s+LEFT JOIN checkin_stations cs ON cs\.id = ls\.station_id AND ls\.action = 'checkin'\s+WHERE a\.event_id = \$1 AND a\.checkin_status = true AND a\.deleted_at IS NULL\s+\)\s+SELECT 'zone' AS row_kind, ez\.id AS zone_id, ez\.name, COUNT\(attributed\.attendee_id\) AS count, ez\.order_index AS sort_key, NULL::int AS total\s+FROM event_zones ez\s+LEFT JOIN attributed ON attributed\.zone_id = ez\.id\s+WHERE ez\.event_id = \$1\s+GROUP BY ez\.id, ez\.name, ez\.order_index\s+UNION ALL\s+SELECT 'unattributed', NULL, NULL, COUNT\(\*\), NULL, NULL\s+FROM attributed\s+WHERE attributed\.zone_id IS NULL\s+UNION ALL\s+SELECT 'totals', NULL, NULL, counts\.checked_in, NULL, counts\.total\s+FROM counts\s+ORDER BY sort_key NULLS LAST`

// monitorOverviewRows builds a pgxmock row set with the 6 columns
// GetMonitorOverview scans: row_kind, zone_id, name, count, sort_key, total.
func monitorOverviewRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{"row_kind", "zone_id", "name", "count", "sort_key", "total"})
}

// TestGetMonitorOverviewReturnsTotalsZonesAndUnattributedFromOneQuery
// proves the exact SQL and the row_kind scanning discriminator: 'zone' rows
// (including a zero-count zone, which must still appear — LEFT JOIN FROM
// event_zones, not the other way around) become MonitorZoneCount entries,
// the 'unattributed' row becomes unattributed, and the 'totals' row becomes
// total/checkedIn. Also proves the load-bearing invariant
// sum(zones)+unattributed == checkedIn on this fixture — all from the SAME
// mocked statement.
func TestGetMonitorOverviewReturnsTotalsZonesAndUnattributedFromOneQuery(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	zoneA := uuid.New()
	zoneB := uuid.New()
	zoneEmpty := uuid.New()

	mock.ExpectQuery(getMonitorOverviewSQL).
		WithArgs(eventID).
		WillReturnRows(monitorOverviewRows().
			AddRow("zone", &zoneB, strPtr("Zone B"), 1, intPtr(1), (*int)(nil)).
			AddRow("zone", &zoneA, strPtr("Zone A"), 2, intPtr(2), (*int)(nil)).
			AddRow("zone", &zoneEmpty, strPtr("Zone Empty"), 0, intPtr(3), (*int)(nil)).
			AddRow("unattributed", (*uuid.UUID)(nil), (*string)(nil), 1, (*int)(nil), (*int)(nil)).
			AddRow("totals", (*uuid.UUID)(nil), (*string)(nil), 4, (*int)(nil), intPtr(10)))

	s := &PGStore{db: mock}
	total, checkedIn, zones, unattributed, err := s.GetMonitorOverview(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorOverview: %v", err)
	}
	if total != 10 {
		t.Errorf("total = %d, want 10", total)
	}
	if checkedIn != 4 {
		t.Errorf("checkedIn = %d, want 4", checkedIn)
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
	if sum+unattributed != checkedIn {
		t.Errorf("sum(zones)+unattributed = %d, want %d (invariant broken)", sum+unattributed, checkedIn)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetMonitorOverviewZeroAttendeeEventReturnsZeros proves a
// freshly-created event with no attendees, no zones, and no check-ins
// reports zeroed total/checkedIn/unattributed and a nil zones slice, not an
// error — COUNT(*) over an empty row set is 0, never NULL, and the
// unattributed/totals branches always return exactly one row each.
func TestGetMonitorOverviewZeroAttendeeEventReturnsZeros(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(getMonitorOverviewSQL).
		WithArgs(eventID).
		WillReturnRows(monitorOverviewRows().
			AddRow("unattributed", (*uuid.UUID)(nil), (*string)(nil), 0, (*int)(nil), (*int)(nil)).
			AddRow("totals", (*uuid.UUID)(nil), (*string)(nil), 0, (*int)(nil), intPtr(0)))

	s := &PGStore{db: mock}
	total, checkedIn, zones, unattributed, err := s.GetMonitorOverview(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetMonitorOverview: %v", err)
	}
	if total != 0 || checkedIn != 0 {
		t.Errorf("total=%d checkedIn=%d, want 0, 0", total, checkedIn)
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

// --- PR #81 bot-review round Finding A3: exact rate window ---

// getCountRecentCheckinsSQL matches CountRecentCheckins' exact SELECT — an
// exact COUNT(*) with a >= cutoff, no minute truncation and no day clamp
// (replaces the former bucket-summing approach in computeRates, which
// undercounted by excluding a bucket's minute-START timestamp from the
// window even when most of the bucket's seconds fell inside it, and which
// separately clamped to UTC start-of-day).
const getCountRecentCheckinsSQL = `SELECT COUNT\(\*\) FROM checkin_actions WHERE event_id = \$1 AND action = 'checkin' AND created_at >= \$2`

func TestCountRecentCheckinsReturnsExactCount(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	since := time.Date(2026, 7, 18, 11, 55, 30, 0, time.UTC)

	mock.ExpectQuery(getCountRecentCheckinsSQL).
		WithArgs(eventID, since).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(7))

	s := &PGStore{db: mock}
	got, err := s.CountRecentCheckins(context.Background(), eventID, since)
	if err != nil {
		t.Fatalf("CountRecentCheckins: %v", err)
	}
	if got != 7 {
		t.Errorf("got = %d, want 7", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestCountRecentCheckinsNoneReturnsZero proves an event with no 'checkin'
// actions since the cutoff reports 0, not an error.
func TestCountRecentCheckinsNoneReturnsZero(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	since := time.Date(2026, 7, 18, 11, 55, 30, 0, time.UTC)

	mock.ExpectQuery(getCountRecentCheckinsSQL).
		WithArgs(eventID, since).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	s := &PGStore{db: mock}
	got, err := s.CountRecentCheckins(context.Background(), eventID, since)
	if err != nil {
		t.Fatalf("CountRecentCheckins: %v", err)
	}
	if got != 0 {
		t.Errorf("got = %d, want 0", got)
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
