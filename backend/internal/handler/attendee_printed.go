package handler

import (
	"errors"
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

// MarkAttendeePrinted increments an attendee's printed_count by one and
// returns the new count. This backs the attendees table's existing
// "Printed" pill (models.Attendee.PrintedCount) — see reconciliation #6 in
// docs/superpowers/plans/2026-07-16-panel-p3.2-print-truth.md: printed_count
// had NO write path anywhere before this endpoint (no handler field, no
// client bump). It is deliberately NOT a print journal — no per-print audit
// rows, no dedupe/job-status tracking; the spec's "server-side print
// journal is out of scope" clause targets audit/dedupe journals, not this
// pre-existing counter.
func (h *Handler) MarkAttendeePrinted(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("attendee_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	// Existence/ownership established FIRST (house convention: 404-masks a
	// missing attendee identically to a foreign one — no existence oracle).
	if _, err := h.requireAttendeeOwnership(c, attendeeID); err != nil {
		return writeErr(c, err)
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

	return c.JSON(http.StatusOK, MarkAttendeePrintedResponse{PrintedCount: newCount})
}
