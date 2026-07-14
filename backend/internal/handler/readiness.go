package handler

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// ReadinessStep is one pipeline step in the per-event readiness aggregate.
type ReadinessStep struct {
	Key    string `json:"key"`
	Status string `json:"status"`
	Count  *int   `json:"count,omitempty"`
}

// EventReadinessResponse is the parent-spec backend #6 aggregate.
type EventReadinessResponse struct {
	Ready bool            `json:"ready"`
	Steps []ReadinessStep `json:"steps"`
}

const (
	readinessDone    = "done"
	readinessNotDone = "not_done"
	readinessSkipped = "skipped"
)

// GetEventReadiness computes the readiness pipeline for one event.
// ready = attendees && badge && staff; zones never blocks (skipped when
// absent); equipment is always not_done until its P3/P4 wiring exists.
func (h *Handler) GetEventReadiness(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	event, err := h.requireEventOwnership(c, id)
	if err != nil {
		return writeErr(c, err)
	}
	ctx := c.Request().Context()

	attendeeCount, err := h.Store.CountAttendeesByEventID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to compute readiness"})
	}
	zones, err := h.Store.GetEventZones(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to compute readiness"})
	}
	staff, err := h.Store.GetEventStaff(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to compute readiness"})
	}

	// Badge template is stored by the editor at custom_fields["badgeTemplate"]
	// (the same key BadgeZPL reads).
	badgeDone := false
	if raw, ok := event.CustomFields["badgeTemplate"]; ok && raw != nil {
		if s, isStr := raw.(string); !isStr || s != "" {
			badgeDone = true
		}
	}

	boolStatus := func(done bool) string {
		if done {
			return readinessDone
		}
		return readinessNotDone
	}
	zoneStatus := readinessSkipped
	if len(zones) > 0 {
		zoneStatus = readinessDone
	}
	zoneCount := len(zones)
	staffCount := len(staff)

	steps := []ReadinessStep{
		{Key: "attendees", Status: boolStatus(attendeeCount > 0), Count: &attendeeCount},
		{Key: "badge", Status: boolStatus(badgeDone)},
		{Key: "zones", Status: zoneStatus, Count: &zoneCount},
		{Key: "staff", Status: boolStatus(staffCount > 0), Count: &staffCount},
		{Key: "equipment", Status: readinessNotDone},
	}
	return c.JSON(http.StatusOK, EventReadinessResponse{
		Ready: attendeeCount > 0 && badgeDone && staffCount > 0,
		Steps: steps,
	})
}
