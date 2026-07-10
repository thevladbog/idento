package store

import (
	"context"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// GetEventStats returns the event's total/checked-in attendee counts, and — if
// zoneID is given — a breakdown of that zone's scan outcomes (from
// zone_scan_log, written by ZoneScan) for the mobile status-bar KPIs.
func (s *PGStore) GetEventStats(ctx context.Context, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error) {
	resp := &models.EventStatsResponse{}

	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`,
		eventID,
	).Scan(&resp.TotalAttendees); err != nil {
		return nil, err
	}

	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL AND checkin_status = true`,
		eventID,
	).Scan(&resp.CheckedIn); err != nil {
		return nil, err
	}

	if zoneID == nil {
		return resp, nil
	}

	zoneStats := &models.ZoneScanStats{}
	rows, err := s.db.Query(ctx,
		`SELECT verdict, COUNT(*) FROM zone_scan_log WHERE zone_id = $1 GROUP BY verdict`,
		*zoneID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var verdict string
		var count int
		if err := rows.Scan(&verdict, &count); err != nil {
			return nil, err
		}
		switch verdict {
		case "allowed":
			zoneStats.Allowed = count
		case "no_access":
			zoneStats.NoAccess = count
		case "not_registered":
			zoneStats.NotRegistered = count
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	resp.ZoneStats = zoneStats
	return resp, nil
}
