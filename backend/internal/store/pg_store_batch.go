package store

import (
	"context"
	"fmt"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// ApplyBatchCheckin applies one offline-queued item idempotently: if
// item.ClientUUID was already logged, it returns (false, nil) without
// re-applying the write. Otherwise it performs the underlying check-in
// (attendee check-in, or zone entry) and records the dedup log row.
// This is intentionally NOT wrapped in one cross-call transaction — each
// underlying write already has its own uniqueness guarantee (attendee
// check-in is a no-op if already true; zone_checkins has a UNIQUE
// (attendee_id, zone_id, event_day) constraint), and batch_checkin_log's
// PRIMARY KEY on client_uuid means even a true concurrent-retry race can
// only produce one log row, which is what the mobile client's dedup
// depends on.
func (s *PGStore) ApplyBatchCheckin(ctx context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (bool, error) {
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM batch_checkin_log WHERE client_uuid = $1)`,
		item.ClientUUID,
	).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}

	switch item.Kind {
	case "checkin":
		attendee, err := s.GetAttendeeByID(ctx, item.AttendeeID)
		if err != nil {
			return false, err
		}
		if attendee == nil {
			return false, fmt.Errorf("attendee not found")
		}
		if !attendee.CheckinStatus {
			attendee.CheckinStatus = true
			attendee.CheckedInAt = &item.At
			attendee.CheckedInBy = &staffUserID
			if err := s.UpdateAttendee(ctx, attendee); err != nil {
				return false, err
			}
		}
	case "zone_entry":
		if item.ZoneID == nil {
			return false, fmt.Errorf("zone_id is required for kind=zone_entry")
		}
		// NOTE: CheckAttendeeZoneCheckin truncates its `date` argument to
		// midnight internally before querying, but CreateZoneCheckin stores
		// EventDay exactly as given. Passing item.At (with its time-of-day
		// component) to both would make the idempotency check and the write
		// disagree — CreateZoneCheckin would store per-time-of-day rows
		// instead of one per calendar day, defeating the UNIQUE
		// (attendee_id, zone_id, event_day) constraint's intent and allowing
		// duplicate zone entries on retried/re-ordered offline-sync batches.
		// Truncate once here and reuse it for both calls (same fix pattern
		// as ZoneScan, Task 3 review).
		eventDay := item.At.Truncate(24 * time.Hour)
		existing, err := s.CheckAttendeeZoneCheckin(ctx, item.AttendeeID, *item.ZoneID, eventDay)
		if err != nil {
			return false, err
		}
		if existing == nil {
			if err := s.CreateZoneCheckin(ctx, &models.ZoneCheckin{
				AttendeeID:  item.AttendeeID,
				ZoneID:      *item.ZoneID,
				CheckedInBy: &staffUserID,
				EventDay:    eventDay,
				Metadata:    map[string]interface{}{"device_number": item.DeviceNumber, "source": "batch"},
			}); err != nil {
				return false, err
			}
		}
	default:
		return false, fmt.Errorf("unknown kind: %s", item.Kind)
	}

	_, err := s.db.Exec(ctx,
		`INSERT INTO batch_checkin_log (client_uuid, event_id, attendee_id, kind, zone_id, device_number, checked_in_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (client_uuid) DO NOTHING`,
		item.ClientUUID, eventID, item.AttendeeID, item.Kind, item.ZoneID, item.DeviceNumber, item.At,
	)
	if err != nil {
		return false, err
	}
	return true, nil
}
