package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// monitorOverviewSQL is GetMonitorOverview's single statement — it produces
// ALL FOUR of the monitor snapshot's totals/zones outputs (total,
// checked_in, per-zone counts, unattributed) from ONE statement, so they
// all read the SAME MVCC snapshot (PostgreSQL takes one snapshot per
// statement under READ COMMITTED, covering every CTE within it). Before
// this method existed, total/checked_in came from GetMonitorCounts and
// zones/unattributed came from GetMonitorZones — two independently-issued
// statements that could each see a different snapshot if a check-in/undo
// landed between them, transiently breaking the documented invariant
// sum(zones)+unattributed == checked_in (PR #81 bot-review round, Finding
// A1). It has four parts:
//
//  1. counts: the event's total non-deleted attendee count and
//     currently-checked-in count — COUNT(*) and COUNT(*) FILTER (WHERE
//     checkin_status) over the same attendees row set. Always exactly one
//     row (a bare aggregate with no GROUP BY).
//  2. latest_state: each attendee's MOST RECENT state-changing action —
//     'checkin' OR 'undo' (NOT 'reprint', which never changes check-in
//     state and must not mask an undo) — DISTINCT ON (ca.attendee_id) ...
//     ORDER BY ca.attendee_id, ca.created_at DESC, ca.id DESC. The id
//     tie-breaker matches GetCheckinActions' ordering (PR #77 bot-review
//     round, Finding E). Including 'undo' here (not just 'checkin') is PR
//     #81 Finding A2's fix: an attendee who checked in at station A, was
//     undone, then got re-checked-in through a path that writes NO action
//     row (e.g. rows predating the 2026-07-19 event-wide actions-feed
//     change, or a legacy path whose log-don't-fail feed insert failed)
//     is currently checked in but their latest ACTION is the
//     'undo' — they must fall to unattributed, not be attributed to
//     station A's zone from the now-superseded 'checkin' row. ca.created_at
//     is also carried through here (not just action/station_id) to support
//     part 3's current-period guard below.
//  3. attributed: one row per CURRENTLY checked-in attendee (checkin_status
//     = true AND deleted_at IS NULL), LEFT JOINed to latest_state and then
//     to checkin_stations — but the checkin_stations join only fires when
//     latest_state.action = 'checkin' AND that action belongs to the
//     attendee's CURRENT check-in period (ls.created_at >= a.checked_in_at
//     — PR #81 round-3 convergence, Backend Finding 2), so an attendee
//     whose latest state-changing action is 'undo' carries zone_id = NULL
//     (unattributed) even though a 'checkin' row still physically exists in
//     their history. The current-period guard closes a narrower gap A2
//     alone doesn't: attendee checked in at station A (writes a 'checkin'
//     action), cleared then re-checked-in via writes that produced NO
//     action rows (pre-2026-07-19 legacy traffic, or feed inserts lost to
//     log-don't-fail) — the latest state-changing action is
//     still that OLD 'checkin' row, so without the guard it would be
//     wrongly attributed to station A's zone for a check-in it never
//     actually observed. It works because CheckInAttendee's guarded UPDATE
//     (pg_store.go's checkInAttendeeGuardedUpdateSQL) sets checked_in_at =
//     now() and checkinActionInsertSQL's created_at DEFAULT now() run in
//     the SAME transaction — Postgres's now() is transaction-stable, so
//     they're EXACTLY equal for every legitimate station attribution, while
//     any action predating a legacy re-checkin's fresh checked_in_at falls
//     outside the >= comparison and is excluded. a.checked_in_at IS NOT
//     NULL is required defensively too: a checked-in row with a null
//     checked_in_at (should not happen, but the column has always been
//     nullable — see migration 000001) reads as unattributed rather than
//     comparing NULL >= NULL (which SQL never treats as true). This is the
//     row set the zones/unattributed halves are BOTH aggregated from.
//  4. The final SELECT/UNION ALL: one row per event_zones row (LEFT JOIN
//     FROM event_zones so a zone with zero currently-checked-in attendees
//     still appears with checked_in = 0), UNION ALL with one row for the
//     unattributed count (COUNT(*) over attributed WHERE zone_id IS NULL),
//     UNION ALL with one row for counts' total/checked_in. A row_kind
//     discriminator column ('zone' | 'unattributed' | 'totals') tells the
//     scanner which branch produced each row. Because the zone and
//     unattributed rows both aggregate the SAME attributed CTE, and
//     attributed/counts both read attendees within the SAME statement
//     snapshot, sum(zone rows)+unattributed always equals checked_in: the
//     invariant holds by construction, not by two queries that happen to
//     agree today.
const monitorOverviewSQL = `
	WITH counts AS (
		SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE checkin_status) AS checked_in
		FROM attendees
		WHERE event_id = $1 AND deleted_at IS NULL
	),
	latest_state AS (
		SELECT DISTINCT ON (ca.attendee_id) ca.attendee_id, ca.action, ca.station_id, ca.created_at
		FROM checkin_actions ca
		WHERE ca.event_id = $1 AND ca.action IN ('checkin', 'undo')
		ORDER BY ca.attendee_id, ca.created_at DESC, ca.id DESC
	),
	attributed AS (
		SELECT a.id AS attendee_id, cs.zone_id AS zone_id
		FROM attendees a
		LEFT JOIN latest_state ls ON ls.attendee_id = a.id
		LEFT JOIN checkin_stations cs ON cs.id = ls.station_id
			AND ls.action = 'checkin'
			AND a.checked_in_at IS NOT NULL
			AND ls.created_at >= a.checked_in_at
		WHERE a.event_id = $1 AND a.checkin_status = true AND a.deleted_at IS NULL
	)
	SELECT 'zone' AS row_kind, ez.id AS zone_id, ez.name, COUNT(attributed.attendee_id) AS count, ez.order_index AS sort_key, NULL::int AS total
	FROM event_zones ez
	LEFT JOIN attributed ON attributed.zone_id = ez.id
	WHERE ez.event_id = $1
	GROUP BY ez.id, ez.name, ez.order_index

	UNION ALL

	SELECT 'unattributed', NULL, NULL, COUNT(*), NULL, NULL
	FROM attributed
	WHERE attributed.zone_id IS NULL

	UNION ALL

	SELECT 'totals', NULL, NULL, counts.checked_in, NULL, counts.total
	FROM counts

	ORDER BY sort_key NULLS LAST`

// GetMonitorOverview returns the monitor snapshot's total attendee count,
// currently-checked-in count, every zone's currently-checked-in count, and
// the count of checked-in attendees that can't be attributed to any zone —
// all from ONE statement (see monitorOverviewSQL) so sum(zones)+unattributed
// == checkedIn holds BY CONSTRUCTION and can never transiently disagree
// with total/checkedIn (PR #81 bot-review round, Finding A1). An attendee's
// zone comes from their MOST RECENT 'checkin' action, but only when no
// LATER 'undo' supersedes it (Finding A2) — DISTINCT ON (ca.attendee_id)
// over ('checkin', 'undo') actions, ORDER BY ca.attendee_id, ca.created_at
// DESC, ca.id DESC (the same id tie-breaker as GetCheckinActions, PR #77
// bot-review round Finding E) — AND only when that action falls within the
// attendee's CURRENT check-in period, i.e. ca.created_at >=
// attendees.checked_in_at (PR #81 round-3 convergence, Backend Finding 2:
// a clear + re-checkin that left no action rows — pre-2026-07-19 legacy
// traffic or lost log-don't-fail inserts — must not inherit attribution
// from a now-stale 'checkin' action that
// predates the CURRENT check-in) — joined through checkin_stations.zone_id
// to event_zones; a checked-in attendee with no 'checkin' action row, whose
// latest state-changing action is 'undo', whose only 'checkin' action
// predates their current check-in period, a station-less action, or a
// zone-less station all count into unattributed rather than any zone.
// Zones are listed in event_zones.order_index order and INCLUDE zero-count
// zones (LEFT JOIN FROM event_zones, not the other way around, so an empty
// zone never silently disappears from the list).
func (s *PGStore) GetMonitorOverview(ctx context.Context, eventID uuid.UUID) (total int, checkedIn int, zones []MonitorZoneCount, unattributed int, err error) {
	rows, err := s.db.Query(ctx, monitorOverviewSQL, eventID)
	if err != nil {
		return 0, 0, nil, 0, err
	}
	defer rows.Close()

	for rows.Next() {
		var rowKind string
		var zoneID *uuid.UUID
		var name *string
		var count int
		var sortKey *int
		var totalCol *int
		if err := rows.Scan(&rowKind, &zoneID, &name, &count, &sortKey, &totalCol); err != nil {
			return 0, 0, nil, 0, err
		}
		switch rowKind {
		case "zone":
			zones = append(zones, MonitorZoneCount{ZoneID: *zoneID, Name: *name, CheckedIn: count})
		case "unattributed":
			unattributed = count
		case "totals":
			checkedIn = count
			if totalCol != nil {
				total = *totalCol
			}
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, nil, 0, err
	}
	return total, checkedIn, zones, unattributed, nil
}

// CountRecentCheckins returns the exact count of 'checkin' actions for
// eventID at/after since — no minute truncation, no day clamp (PR #81
// bot-review round, Finding A3). It replaces the previous rate_per_min
// computation, which derived its 5-minute window from
// GetMonitorMinuteBuckets' minute-START buckets (systematically
// undercounting up to ~20% — a bucket whose start is just before the
// window boundary was excluded wholesale even though most of its seconds
// fall inside the window) additionally clamped to UTC start-of-day (for
// ~5 minutes after midnight the window reached into "yesterday" and got
// nothing). The caller passes since = now.Add(-5*time.Minute) for
// totals.rate_per_min; GetMonitorMinuteBuckets is unrelated and stays
// bucket-based — it backs ONLY totals.peak ("today's" highest one-minute
// bucket), which is legitimately day-scoped and unaffected by this
// finding.
func (s *PGStore) CountRecentCheckins(ctx context.Context, eventID uuid.UUID, since time.Time) (int, error) {
	var count int
	err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM checkin_actions WHERE event_id = $1 AND action = 'checkin' AND created_at >= $2`,
		eventID, since,
	).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetMonitorMinuteBuckets returns one row per minute (ascending) holding
// the count of 'checkin' actions in that minute, for created_at >= since
// (P4.2 Task 2). The caller passes a UTC start-of-day for the monitor's
// today's-peak computation; the per-5-minute rate reuses these SAME buckets
// rather than issuing a second query.
func (s *PGStore) GetMonitorMinuteBuckets(ctx context.Context, eventID uuid.UUID, since time.Time) ([]MinuteBucket, error) {
	rows, err := s.db.Query(ctx, `
		SELECT date_trunc('minute', created_at) AS minute, COUNT(*)
		FROM checkin_actions
		WHERE event_id = $1 AND action = 'checkin' AND created_at >= $2
		GROUP BY minute
		ORDER BY minute ASC`, eventID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var buckets []MinuteBucket
	for rows.Next() {
		var b MinuteBucket
		if err := rows.Scan(&b.Minute, &b.Count); err != nil {
			return nil, err
		}
		buckets = append(buckets, b)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return buckets, nil
}

// GetMonitorStations returns every check-in station for eventID with its
// LEFT JOINed 'checkin'-action count — COUNT(...) FILTER (WHERE ca.action =
// 'checkin'), so 'undo'/'reprint' rows sharing the same station_id don't
// inflate the count — ordered by name, the same deterministic-listing
// convention as ListCheckinStations, with the running count attached for
// the monitor's stations card. The join also carries an `ca.event_id =
// cs.event_id` predicate (PR #81 round-2 convergence Finding 2): station_id
// alone uniquely identifies the event already (stations don't move between
// events), but without the event predicate in the join condition itself,
// Postgres plans this as a join against the ENTIRE checkin_actions table
// before filtering — for tenants with many actions in other events, that
// can't use idx_checkin_actions_event_created and forces a scan/hash of the
// global table on every snapshot refetch. cs.event_id needs no new query
// param since the stations are already event-filtered by the WHERE clause.
func (s *PGStore) GetMonitorStations(ctx context.Context, eventID uuid.UUID) ([]MonitorStation, error) {
	rows, err := s.db.Query(ctx, `
		SELECT cs.id, cs.name, cs.zone_id, cs.last_seen_at, COUNT(ca.id) FILTER (WHERE ca.action = 'checkin')
		FROM checkin_stations cs
		LEFT JOIN checkin_actions ca ON ca.station_id = cs.id AND ca.event_id = cs.event_id
		WHERE cs.event_id = $1
		GROUP BY cs.id, cs.name, cs.zone_id, cs.last_seen_at
		ORDER BY cs.name`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stations []MonitorStation
	for rows.Next() {
		var st MonitorStation
		if err := rows.Scan(&st.ID, &st.Name, &st.ZoneID, &st.LastSeenAt, &st.CheckinCount); err != nil {
			return nil, err
		}
		stations = append(stations, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return stations, nil
}
