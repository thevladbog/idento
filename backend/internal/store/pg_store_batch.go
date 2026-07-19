package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
	// BatchCheckinAlreadyCheckedIn means a kind=checkin item's guarded
	// `UPDATE ... WHERE checkin_status = false` affected zero rows — the
	// attendee was already checked in (by this or another client_uuid/device)
	// by the time the atomic write was evaluated — no write was made here,
	// regardless of which client_uuid is submitting.
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
// The batch_checkin_log insert is intentionally NOT in any shared
// transaction — each underlying write already has its own uniqueness
// guarantee: the kind=checkin write is a single `UPDATE ... WHERE
// checkin_status = false` guarded update (see below — this is what makes
// the read-then-write for that path atomic, rather than a Go-level
// check-then-act race) run in one short tx together with its event-wide
// actions-feed row (2026-07-19 design — the tx makes the feed row atomic
// with the state change, NOT the dedup), zone_checkins has a UNIQUE
// (attendee_id, zone_id, event_day) constraint, and batch_checkin_log's
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
		// Existence check only — attendee's other fields are not needed below
		// (the batch_checkin_log insert uses item.* fields, not attendee.*),
		// so this is NOT used to decide whether to write. Deciding the write
		// from a value read here would reintroduce the TOCTOU race the
		// guarded UPDATE below closes: two near-simultaneous requests for the
		// same attendee (e.g. two devices scanning the same badge) could both
		// observe checkin_status=false here before either write lands.
		attendee, err := s.GetAttendeeByID(ctx, item.AttendeeID)
		if err != nil {
			return BatchCheckinCreated, err
		}
		if attendee == nil {
			return BatchCheckinCreated, fmt.Errorf("attendee not found")
		}

		// The state transition itself must be atomic at the database level.
		// This single guarded UPDATE makes Postgres the sole arbiter of which
		// concurrent request (if any) actually performs the check-in: only
		// the request whose UPDATE flips checkin_status from false to true
		// affects a row. Any other concurrent request's guarded UPDATE
		// affects zero rows — it never overwrites the row that already won,
		// and is reported as BatchCheckinAlreadyCheckedIn rather than
		// (incorrectly) BatchCheckinCreated.
		//
		// The UPDATE and — when it wins — the event-wide actions-feed row
		// (2026-07-19 design) run in ONE short transaction, mirroring
		// CheckInAttendee: the feed row commits atomically with the state
		// change, and a failure rolls BOTH back so a client retry (whose
		// client_uuid was never logged) re-applies cleanly.
		deviceNumber := item.DeviceNumber
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return BatchCheckinCreated, err
		}
		defer func() {
			if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
				log.Printf("rollback batch check-in: %v", rbErr)
			}
		}()
		tag, err := tx.Exec(ctx,
			`UPDATE attendees
			 SET checkin_status = true, checked_in_at = $1, checked_in_by = $2,
			     checked_in_device_number = $3, checked_in_point_name = $4, updated_at = NOW()
			 WHERE id = $5 AND checkin_status = false AND deleted_at IS NULL`,
			item.At, &staffUserID, &deviceNumber, item.PointName, item.AttendeeID,
		)
		if err != nil {
			return BatchCheckinCreated, err
		}
		if tag.RowsAffected() == 1 {
			outcome = BatchCheckinCreated
			// Event-wide actions feed (2026-07-19 design): a station-less
			// 'checkin' row stamped with created_at = item.At — the exact
			// value the UPDATE above wrote into checked_in_at, so the
			// monitor's current-period predicate (ca.created_at >=
			// a.checked_in_at) holds by equality with zero clock
			// dependence (the offline device's clock skew is a
			// pre-existing trust: checked_in_at already carries it).
			// NULL station_id lands the attendee in the monitor's
			// unattributed bucket via the existing join, preserving
			// sum(zones)+unattributed == checked_in by construction.
			if err := insertCheckinActionAt(ctx, tx, eventID, item.AttendeeID, "checkin", nil, &staffUserID, &item.At); err != nil {
				return BatchCheckinCreated, err
			}
		} else {
			// Someone else's check-in already landed for this attendee (or the
			// row was concurrently soft-deleted after the existence check
			// above) — no write was made here, and this request's data must
			// not silently overwrite whatever check-in already exists. No
			// feed row either: nothing changed.
			outcome = BatchCheckinAlreadyCheckedIn
		}
		if err := tx.Commit(ctx); err != nil {
			return BatchCheckinCreated, err
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
