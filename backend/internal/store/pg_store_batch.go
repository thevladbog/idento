package store

import (
	"context"
	"fmt"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
)

// BatchCheckinOutcome distinguishes the possible results of applying one
// offline-queued batch item, so callers (and ultimately the mobile client,
// via the handler's response) can tell a genuine first-time write apart from
// the two kinds of no-op: the attendee's check-in already existed (possibly
// applied by a different device/client_uuid), or this exact client_uuid was
// already processed before (idempotent replay of the same request).
type BatchCheckinOutcome int

const (
	// BatchCheckinCreated means this call performed the underlying write
	// (attendee check-in, or zone entry) for the first time.
	BatchCheckinCreated BatchCheckinOutcome = iota
	// BatchCheckinAlreadyCheckedIn means a kind=checkin item's attendee was
	// already checked in (attendee.CheckinStatus was already true) — no
	// write was made, regardless of which client_uuid is submitting.
	BatchCheckinAlreadyCheckedIn
	// BatchCheckinDuplicateClientUUID means this exact item.ClientUUID was
	// already present in batch_checkin_log — a true idempotent replay of a
	// previously-processed request. No work was attempted at all.
	BatchCheckinDuplicateClientUUID
)

// ApplyBatchCheckin applies one offline-queued item idempotently: if
// item.ClientUUID was already logged, it returns (BatchCheckinDuplicateClientUUID, nil)
// without re-applying the write. Otherwise it performs the underlying check-in
// (attendee check-in, or zone entry) and records the dedup log row, returning
// BatchCheckinCreated for a genuine first-time write or
// BatchCheckinAlreadyCheckedIn if a kind=checkin item's attendee was already
// checked in (by this or another client_uuid/device).
// This is intentionally NOT wrapped in one cross-call transaction — each
// underlying write already has its own uniqueness guarantee (attendee
// check-in is a no-op if already true; zone_checkins has a UNIQUE
// (attendee_id, zone_id, event_day) constraint), and batch_checkin_log's
// PRIMARY KEY on client_uuid means even a true concurrent-retry race can
// only produce one log row, which is what the mobile client's dedup
// depends on.
func (s *PGStore) ApplyBatchCheckin(ctx context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (BatchCheckinOutcome, error) {
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM batch_checkin_log WHERE client_uuid = $1)`,
		item.ClientUUID,
	).Scan(&exists); err != nil {
		return BatchCheckinCreated, err
	}
	if exists {
		return BatchCheckinDuplicateClientUUID, nil
	}

	outcome := BatchCheckinCreated

	switch item.Kind {
	case "checkin":
		attendee, err := s.GetAttendeeByID(ctx, item.AttendeeID)
		if err != nil {
			return BatchCheckinCreated, err
		}
		if attendee == nil {
			return BatchCheckinCreated, fmt.Errorf("attendee not found")
		}
		if !attendee.CheckinStatus {
			attendee.CheckinStatus = true
			attendee.CheckedInAt = &item.At
			attendee.CheckedInBy = &staffUserID
			attendee.CheckedInDeviceNumber = &item.DeviceNumber
			attendee.CheckedInPointName = item.PointName
			if err := s.UpdateAttendee(ctx, attendee); err != nil {
				return BatchCheckinCreated, err
			}
		} else {
			// Already checked in — possibly by a different device/client_uuid.
			// No write is made, and the caller must be able to tell this apart
			// from a genuine first-time check-in (see BatchCheckinAlreadyCheckedIn).
			outcome = BatchCheckinAlreadyCheckedIn
		}
	case "zone_entry":
		if item.ZoneID == nil {
			return BatchCheckinCreated, fmt.Errorf("zone_id is required for kind=zone_entry")
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
			return BatchCheckinCreated, err
		}
		if existing == nil {
			if err := s.CreateZoneCheckin(ctx, &models.ZoneCheckin{
				AttendeeID:  item.AttendeeID,
				ZoneID:      *item.ZoneID,
				CheckedInBy: &staffUserID,
				EventDay:    eventDay,
				Metadata:    map[string]interface{}{"device_number": item.DeviceNumber, "source": "batch"},
			}); err != nil {
				return BatchCheckinCreated, err
			}
		}
		// NOTE: unlike kind=checkin, a pre-existing zone entry does not get its
		// own outcome value here — there is no mobile-facing "already in zone"
		// verdict analogous to AlreadyChecked today, so this intentionally
		// still reports BatchCheckinCreated. If a future zone-control feature
		// needs to distinguish this case, add a dedicated outcome value rather
		// than overloading BatchCheckinAlreadyCheckedIn (whose name is
		// specific to the registration check-in domain).
	default:
		return BatchCheckinCreated, fmt.Errorf("unknown kind: %s", item.Kind)
	}

	_, err := s.db.Exec(ctx,
		`INSERT INTO batch_checkin_log (client_uuid, event_id, attendee_id, kind, zone_id, device_number, checked_in_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (client_uuid) DO NOTHING`,
		item.ClientUUID, eventID, item.AttendeeID, item.Kind, item.ZoneID, item.DeviceNumber, item.At,
	)
	if err != nil {
		return BatchCheckinCreated, err
	}
	return outcome, nil
}
