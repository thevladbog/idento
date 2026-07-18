package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// GetMonitorCounts returns the total non-deleted attendee count and the
// currently-checked-in count for eventID (P4.2 Task 2) from ONE query —
// COUNT(*) and COUNT(*) FILTER (WHERE checkin_status) over the same
// attendees row set — so the two numbers can never disagree the way two
// separately-issued queries against a live, concurrently-changing event
// could (a check-in landing between them).
func (s *PGStore) GetMonitorCounts(ctx context.Context, eventID uuid.UUID) (total int, checkedIn int, err error) {
	err = s.db.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE checkin_status) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`,
		eventID,
	).Scan(&total, &checkedIn)
	if err != nil {
		return 0, 0, err
	}
	return total, checkedIn, nil
}

// monitorZonesSQL is GetMonitorZones' single statement. It has three
// parts:
//
//  1. latest_checkin: each attendee's MOST RECENT 'checkin' action —
//     DISTINCT ON (ca.attendee_id) ... ORDER BY ca.attendee_id,
//     ca.created_at DESC, ca.id DESC. The id tie-breaker matches
//     GetCheckinActions' ordering (PR #77 bot-review round, Finding E): two
//     'checkin' actions for the same attendee sharing a created_at value
//     would otherwise have no deterministic "most recent" pick.
//  2. attributed: one row per CURRENTLY checked-in attendee (checkin_status
//     = true AND deleted_at IS NULL), LEFT JOINed to latest_checkin and then
//     to checkin_stations, carrying that attendee's zone_id — or NULL when
//     there's no 'checkin' action row, the action's station_id is NULL, or
//     the station's zone_id is NULL. This is the row set BOTH halves of the
//     final result are aggregated from.
//  3. The final SELECT/UNION ALL: one row per event_zones row (LEFT JOIN
//     FROM event_zones so a zone with zero currently-checked-in attendees
//     still appears with checked_in = 0), UNION ALL with exactly one more
//     row — COUNT(*) over attributed WHERE zone_id IS NULL — for the
//     unattributed count. Because both halves aggregate the SAME attributed
//     CTE, sum(zone rows) + unattributed always equals COUNT(attributed.*),
//     which is exactly the checked-in population: the invariant holds by
//     construction, not by two queries that happen to agree today.
const monitorZonesSQL = `
	WITH latest_checkin AS (
		SELECT DISTINCT ON (ca.attendee_id) ca.attendee_id, ca.station_id
		FROM checkin_actions ca
		WHERE ca.event_id = $1 AND ca.action = 'checkin'
		ORDER BY ca.attendee_id, ca.created_at DESC, ca.id DESC
	),
	attributed AS (
		SELECT a.id AS attendee_id, cs.zone_id AS zone_id
		FROM attendees a
		LEFT JOIN latest_checkin lc ON lc.attendee_id = a.id
		LEFT JOIN checkin_stations cs ON cs.id = lc.station_id
		WHERE a.event_id = $1 AND a.checkin_status = true AND a.deleted_at IS NULL
	)
	SELECT ez.id AS zone_id, ez.name, COUNT(attributed.attendee_id) AS checked_in, ez.order_index AS sort_key
	FROM event_zones ez
	LEFT JOIN attributed ON attributed.zone_id = ez.id
	WHERE ez.event_id = $1
	GROUP BY ez.id, ez.name, ez.order_index

	UNION ALL

	SELECT NULL, NULL, COUNT(*), NULL
	FROM attributed
	WHERE attributed.zone_id IS NULL

	ORDER BY sort_key NULLS LAST`

// GetMonitorZones returns every zone's currently-checked-in count, plus the
// count of checked-in attendees that can't be attributed to any zone
// (unattributed) — see monitorZonesSQL for how the single statement makes
// sum(zones)+unattributed == checkedIn hold by construction. Each result
// row's zone_id is NULL for exactly one row (the unattributed total,
// always present — COUNT(*) with no GROUP BY returns one row even when it
// counts zero); every other row is a zone, in event_zones.order_index
// order, zero-count zones included.
func (s *PGStore) GetMonitorZones(ctx context.Context, eventID uuid.UUID) ([]MonitorZoneCount, int, error) {
	rows, err := s.db.Query(ctx, monitorZonesSQL, eventID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var zones []MonitorZoneCount
	unattributed := 0
	for rows.Next() {
		var zoneID *uuid.UUID
		var name *string
		var checkedIn int
		var sortKey *int
		if err := rows.Scan(&zoneID, &name, &checkedIn, &sortKey); err != nil {
			return nil, 0, err
		}
		if zoneID == nil {
			unattributed = checkedIn
			continue
		}
		zones = append(zones, MonitorZoneCount{ZoneID: *zoneID, Name: *name, CheckedIn: checkedIn})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return zones, unattributed, nil
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
// the monitor's stations card.
func (s *PGStore) GetMonitorStations(ctx context.Context, eventID uuid.UUID) ([]MonitorStation, error) {
	rows, err := s.db.Query(ctx, `
		SELECT cs.id, cs.name, cs.zone_id, cs.last_seen_at, COUNT(ca.id) FILTER (WHERE ca.action = 'checkin')
		FROM checkin_stations cs
		LEFT JOIN checkin_actions ca ON ca.station_id = cs.id
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
