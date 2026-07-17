package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

// checkinActionsDefaultLimit is both the DEFAULT and the MAX for GET
// /api/events/{event_id}/checkin-actions' limit query param — the station's
// recent-scans rail (P4.1 board 2c) only ever shows the last 50, so a
// caller-supplied limit is clamped down to this rather than rejected.
const checkinActionsDefaultLimit = 50

// StationCheckinRequest is the request body for POST
// /api/events/{event_id}/checkin (P4.1 Task 3). station_id, when present,
// must belong to the same event (400 "Station not found in event"
// otherwise) — it is optional because a station-less panel check-in (no
// checkin_stations row registered) is still valid.
type StationCheckinRequest struct {
	AttendeeID uuid.UUID  `json:"attendee_id"`
	StationID  *uuid.UUID `json:"station_id,omitempty"`
}

// CheckinInfo is the "checkin" block of StationCheckinResponse — the
// first-scan metadata. For outcome "checked_in" it is THIS scan; for
// "already_checked_in" it is the ORIGINAL scan, never overwritten. It is
// nil for outcome "blocked" (the station renders block_reason from
// attendee instead).
type CheckinInfo struct {
	At        time.Time `json:"at"`
	ByEmail   string    `json:"by_email"`
	PointName *string   `json:"point_name,omitempty"`
}

// StationCheckinResponse is the response for POST
// /api/events/{event_id}/checkin.
type StationCheckinResponse struct {
	Outcome  string           `json:"outcome"`
	Attendee *models.Attendee `json:"attendee"`
	Checkin  *CheckinInfo     `json:"checkin"`
}

// UndoCheckinRequest is the request body for POST
// /api/events/{event_id}/checkin/undo.
type UndoCheckinRequest struct {
	AttendeeID uuid.UUID  `json:"attendee_id"`
	StationID  *uuid.UUID `json:"station_id,omitempty"`
}

// UndoCheckinResponse is the response for POST
// /api/events/{event_id}/checkin/undo.
type UndoCheckinResponse struct {
	Attendee *models.Attendee `json:"attendee"`
}

// CheckinActionsResponse is the response envelope for GET
// /api/events/{event_id}/checkin-actions.
type CheckinActionsResponse struct {
	Actions []store.CheckinActionRow `json:"actions"`
}

// resolveCheckinStation validates a caller-supplied station_id (when
// present) against eventID and returns its display name — used both to
// populate checked_in_point_name (stationCheckin) and to reject a foreign
// station_id (400), shared by stationCheckin and undoCheckin. A nil
// stationID is valid (station-less check-in) and returns ("", nil).
func (h *Handler) resolveCheckinStation(c echo.Context, eventID uuid.UUID, stationID *uuid.UUID) (string, error) {
	if stationID == nil {
		return "", nil
	}
	station, err := h.Store.GetCheckinStationByID(c.Request().Context(), *stationID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", newHTTPError(http.StatusInternalServerError, "Failed to verify station")
	}
	if station == nil || station.EventID != eventID {
		return "", newHTTPError(http.StatusBadRequest, "Station not found in event")
	}
	return station.Name, nil
}

// StationCheckin performs one station's idempotent single-scan check-in
// (P4.1 Task 3) — the zero-double-checkin guarantee at the source. Handler
// order: parse → requireEventOwnership → fetch the attendee via
// requireAttendeeOwnership (404-masked) → if attendee.Blocked, return the
// distinct "blocked" outcome WITHOUT ever attempting a check-in → else
// resolve/validate station_id (400 if foreign) and call
// store.CheckInAttendee. Never touches printed_count and never prints —
// printing is a separate client step gated on the "checked_in" outcome.
func (h *Handler) StationCheckin(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req StationCheckinRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if req.AttendeeID == uuid.Nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "attendee_id is required"})
	}

	// Ownership/existence established before anything else (house
	// convention: 404-masks a missing attendee identically to a foreign
	// one — no existence oracle). A same-tenant attendee belonging to a
	// DIFFERENT event than the path's event_id is a 400, not a 404 — it
	// genuinely exists, it's just the wrong scope (badge_zpl.go precedent).
	attendee, err := h.requireAttendeeOwnership(c, req.AttendeeID)
	if err != nil {
		return writeErr(c, err)
	}
	if attendee.EventID != eventID {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Attendee does not belong to this event"})
	}

	// Blocked short-circuits BEFORE any station validation or store call —
	// a blocked attendee is never checked in, regardless of station_id.
	if attendee.Blocked {
		return c.JSON(http.StatusOK, StationCheckinResponse{Outcome: "blocked", Attendee: attendee, Checkin: nil})
	}

	stationName, err := h.resolveCheckinStation(c, eventID, req.StationID)
	if err != nil {
		return writeErr(c, err)
	}

	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	staffUserID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}
	staffUser, err := h.Store.GetUserByID(c.Request().Context(), staffUserID)
	if err != nil || staffUser == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to resolve staff user"})
	}

	outcome, updated, err := h.Store.CheckInAttendee(c.Request().Context(), eventID, req.AttendeeID, req.StationID, staffUserID, staffUser.Email, stationName)
	if err != nil {
		// ErrAttendeeNotFound is reachable only via the soft-delete race:
		// the ownership pre-check above passed, then a concurrent DELETE
		// set deleted_at before the guarded UPDATE ran (attendee_printed.go
		// precedent) — map it to the same 404 masking, not a 500.
		if errors.Is(err, store.ErrAttendeeNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check in attendee"})
	}

	var checkin *CheckinInfo
	if updated.CheckedInAt != nil {
		byEmail := ""
		if updated.CheckedInByEmail != nil {
			byEmail = *updated.CheckedInByEmail
		}
		checkin = &CheckinInfo{At: *updated.CheckedInAt, ByEmail: byEmail, PointName: updated.CheckedInPointName}
	}

	return c.JSON(http.StatusOK, StationCheckinResponse{Outcome: outcome, Attendee: updated, Checkin: checkin})
}

// UndoCheckin clears a check-in (P4.1 Task 3) — idempotent: undoing an
// attendee who is already not checked in still returns 200 with no feed
// row written (store.UndoCheckin's contract).
func (h *Handler) UndoCheckin(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req UndoCheckinRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if req.AttendeeID == uuid.Nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "attendee_id is required"})
	}

	attendee, err := h.requireAttendeeOwnership(c, req.AttendeeID)
	if err != nil {
		return writeErr(c, err)
	}
	if attendee.EventID != eventID {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Attendee does not belong to this event"})
	}

	if _, err := h.resolveCheckinStation(c, eventID, req.StationID); err != nil {
		return writeErr(c, err)
	}

	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	staffUserID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	updated, err := h.Store.UndoCheckin(c.Request().Context(), eventID, req.AttendeeID, req.StationID, staffUserID)
	if err != nil {
		if errors.Is(err, store.ErrAttendeeNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to undo check-in"})
	}

	return c.JSON(http.StatusOK, UndoCheckinResponse{Attendee: updated})
}

// GetCheckinActions returns an event's check-in/undo/reprint feed, newest
// first (P4.1 Task 3) — backs the station's recent-scans rail. limit
// defaults to and is clamped to checkinActionsDefaultLimit; an
// invalid/non-positive limit query param is ignored (falls back to the
// default) rather than 400ing a read-only feed endpoint.
func (h *Handler) GetCheckinActions(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	limit := checkinActionsDefaultLimit
	if lp := c.QueryParam("limit"); lp != "" {
		if n, err := strconv.Atoi(lp); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > checkinActionsDefaultLimit {
		limit = checkinActionsDefaultLimit
	}

	actions, err := h.Store.GetCheckinActions(c.Request().Context(), eventID, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch check-in actions"})
	}
	if actions == nil {
		actions = []store.CheckinActionRow{}
	}

	return c.JSON(http.StatusOK, CheckinActionsResponse{Actions: actions})
}
