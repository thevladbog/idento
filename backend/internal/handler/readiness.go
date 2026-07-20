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
// absent); equipment is done when the event's tenant has at least one
// machine with a default printer whose test print has passed
// (TenantHasTestedDefaultPrinter) — like zones, equipment never blocks
// ready (spec §4.3).
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
	equipmentDone, err := h.Store.TenantHasTestedDefaultPrinter(ctx, event.TenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to compute readiness"})
	}

	// Badge template: effectiveBadgeTemplate (badge_template.go) reads the
	// dedicated badge_template column exclusively (the P5.2 cutover removed the
	// legacy custom_fields["badgeTemplate"] fallback), decoding its JSONB into
	// map[string]interface{} via json.Unmarshal — the same value BadgeZPL
	// passes to zpl.ParseBadgeTemplate. A NULL column decodes to nil, i.e.
	// "no template".
	//
	// The badge editor persists a JS object ({width_mm, height_mm, dpi,
	// elements}), so the real-world "done" shape is a map, not a string. A
	// naive "non-nil and not a string" check would mark a template as done for
	// ANY map — including a freshly-created one with zero elements, i.e. a
	// blank canvas that isn't actually print-ready. So for the map shape we
	// additionally require a non-empty "elements" array (the same field
	// zpl.ParseBadgeTemplate reads to build the printable elements list).
	//
	// The plain-string branch is kept for forward/backward compatibility —
	// e.g. a future or test-only string-encoded representation — but an
	// empty string never counts as done.
	badgeDone := false
	if raw := effectiveBadgeTemplate(event); raw != nil {
		switch v := raw.(type) {
		case string:
			badgeDone = v != ""
		case map[string]interface{}:
			if elements, ok := v["elements"].([]interface{}); ok && len(elements) > 0 {
				badgeDone = true
			}
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
		{Key: "equipment", Status: boolStatus(equipmentDone)},
	}
	return c.JSON(http.StatusOK, EventReadinessResponse{
		Ready: attendeeCount > 0 && badgeDone && staffCount > 0,
		Steps: steps,
	})
}
