package handler

import (
	"errors"
	"log"
	"net/http"

	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// MarkAttendeePrintedResponse is the response for POST
// /api/attendees/{attendee_id}/printed.
type MarkAttendeePrintedResponse struct {
	PrintedCount int `json:"printed_count"`
}

// markAttendeePrintedRequest is the OPTIONAL request body (P4.1 Task 4):
// when EventID is present, MarkAttendeePrinted also logs a checkin_actions
// ('reprint') feed row after the counter increment succeeds. Both fields
// are plain strings (not uuid.UUID) so a present-but-invalid value can be
// distinguished from an absent one and reported as its own 400, rather
// than failing json.Unmarshal itself.
type markAttendeePrintedRequest struct {
	EventID   *string `json:"event_id"`
	StationID *string `json:"station_id"`
}

// MarkAttendeePrinted increments an attendee's printed_count by one and
// returns the new count. This backs the attendees table's existing
// "Printed" pill (models.Attendee.PrintedCount) — see reconciliation #6 in
// docs/superpowers/plans/2026-07-16-panel-p3.2-print-truth.md: printed_count
// had NO write path anywhere before this endpoint (no handler field, no
// client bump). It is deliberately NOT a print journal — no per-print audit
// rows, no dedupe/job-status tracking; the spec's "server-side print
// journal is out of scope" clause targets audit/dedupe journals, not this
// pre-existing counter.
//
// P4.1 Task 4 adds an OPTIONAL JSON body ({event_id?, station_id?}): when
// event_id is present, AFTER the counter increment succeeds, the handler
// also logs a checkin_actions ('reprint') row via store.InsertCheckinAction
// — this is how the station's recent-scans rail picks up a reprint. A
// body-less call (the pre-existing badge-editor bulk print path) stays
// counter-only, exactly as before. The body is parsed leniently: an absent
// body, an empty body, and a syntactically malformed body are ALL treated
// as "no context" (unknown fields are ignored by plain encoding/json
// decoding too) — the counter still increments in every case. A present
// event_id/station_id value is rejected with 400 in FOUR cases, ALL before
// the counter increments so a rejected request never partially applies:
// (1) station_id is present but event_id is absent — a caller supplying
// station_id clearly intended it to be logged, so silently discarding it
// (the reprint-logging path is gated on event_id != nil) would hide a
// client-side mistake rather than surface it (PR #77 bot-review round,
// Finding D; checked FIRST, before the event_id-parsing cases below); (2)
// event_id fails uuid.Parse, or (3) it parses but doesn't belong to the
// attendee's own event — event_id is NEVER trusted as the source of truth
// for which event the feed row belongs to (fix round 1: the body used to
// be passed straight to InsertCheckinAction, letting an authenticated
// caller who legitimately owns the attendee log a 'reprint' row into an
// arbitrary OTHER event's/tenant's checkin_actions feed). This mirrors the
// same-file precedent set by StationCheckin/UndoCheckin (checkin.go) and
// BadgeZPL (badge_zpl.go), which all 400 with "Attendee does not belong to
// this event" on an attendee/event scope mismatch rather than silently
// substituting the correct event. (4) station_id, when present alongside a
// valid event_id, is validated the same way its siblings do — via
// resolveCheckinStation, 400ing "Station not found in event" for a station
// belonging to a different event. Once all four checks pass, logging
// itself is best-effort: the counter has already committed by the time
// logging is attempted, so a failure resolving staff claims or writing the
// feed row is logged server-side and never turns the response into an
// error or changes its shape.
func (h *Handler) MarkAttendeePrinted(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("attendee_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	// Existence/ownership established FIRST (house convention: 404-masks a
	// missing attendee identically to a foreign one — no existence oracle).
	// The returned attendee is kept (not discarded) — its EventID is the
	// ONLY trustworthy event context for the feed row below; the request
	// body's event_id is validated against it, never used on its own.
	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
	}

	// The optional print-context body: a bind error (empty body, or
	// syntactically malformed JSON) is swallowed here — req simply stays
	// its zero value (both fields nil), which the logic below treats
	// identically to "no body at all" (lenient, back-compat).
	var req markAttendeePrintedRequest
	if err := c.Bind(&req); err != nil {
		req = markAttendeePrintedRequest{}
	}

	// station_id is only ever meaningful alongside event_id (it's used
	// solely by the feed-row insert below, gated on eventID != nil) — a
	// caller supplying station_id without event_id clearly intended it to
	// be logged, so silently discarding it would hide a client-side
	// mistake rather than surface it (PR #77 bot-review round, Finding D).
	// This check runs BEFORE the event_id-mismatch-with-attendee
	// validation below so a malformed combination never partially applies.
	if req.StationID != nil && req.EventID == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "event_id is required when station_id is supplied"})
	}

	var eventID *uuid.UUID
	if req.EventID != nil {
		parsed, err := uuid.Parse(*req.EventID)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event_id"})
		}
		// A same-tenant attendee whose REAL event differs from the body's
		// event_id is a 400, not a silent substitution — same treatment
		// StationCheckin/UndoCheckin/BadgeZPL give an attendee/event scope
		// mismatch (checkin.go, badge_zpl.go).
		if parsed != attendee.EventID {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Attendee does not belong to this event"})
		}
		eventID = &parsed
	}
	var stationID *uuid.UUID
	if req.StationID != nil {
		parsed, err := uuid.Parse(*req.StationID)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid station_id"})
		}
		stationID = &parsed
	}
	// station_id is only meaningful alongside a validated event_id (it's
	// only ever used by the feed-row insert below, gated on eventID != nil)
	// — reuse the exact same-package check StationCheckin/UndoCheckin use
	// (checkin.go:76-88) rather than re-implementing "does this station
	// belong to this event".
	if eventID != nil && stationID != nil {
		if _, err := h.resolveCheckinStation(c, *eventID, stationID); err != nil {
			return writeErr(c, err)
		}
	}

	newCount, err := h.Store.IncrementAttendeePrintedCount(c.Request().Context(), attendeeID)
	if err != nil {
		// ErrAttendeeNotFound is reachable only via the soft-delete race:
		// the ownership pre-check above passed, then a concurrent DELETE
		// /api/attendees/{id} set deleted_at before the guarded UPDATE ran.
		// Map it to the same 404 masking (and wording) as
		// requireAttendeeOwnership — not a 500: the attendee is gone, and
		// "gone" must stay indistinguishable from "never existed".
		if errors.Is(err, store.ErrAttendeeNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update printed count"})
	}

	// Reprint-logging is best-effort and only attempted when event_id was
	// supplied — the counter above has ALREADY committed, so nothing here
	// can turn a successful print-count bump into an error response.
	if eventID != nil {
		claims, err := claimsFromContext(c)
		if err != nil {
			log.Printf("mark attendee printed: skip reprint log, no claims: %v", err)
		} else if staffUserID, err := uuid.Parse(claims.UserID); err != nil {
			log.Printf("mark attendee printed: skip reprint log, invalid staff user id: %v", err)
		} else if err := h.Store.InsertCheckinAction(c.Request().Context(), *eventID, attendeeID, "reprint", stationID, staffUserID); err != nil {
			log.Printf("mark attendee printed: failed to log reprint checkin_actions row: %v", err)
		} else if h.Broker != nil {
			// Publish ONLY reached when the reprint feed row was actually
			// logged (P4.2 Task 4) — a skipped log (no claims, bad staff
			// id, or a store failure above) means the monitor's recent-feed
			// wouldn't show anything new anyway, so signaling it to
			// re-fetch would be a pointless round trip. Nil-safe,
			// best-effort, after the row already committed.
			if pubErr := h.Broker.Publish(c.Request().Context(), *eventID); pubErr != nil {
				log.Printf("mark attendee printed: broker publish failed: %v", pubErr)
			}
		}
	}

	return c.JSON(http.StatusOK, MarkAttendeePrintedResponse{PrintedCount: newCount})
}
