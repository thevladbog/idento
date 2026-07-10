package handler

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// GetEventStats returns event-level and (optionally) zone-level KPI counters
// for the mobile status bar. If ?zone= is given, it must belong to this event.
func (h *Handler) GetEventStats(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var zoneID *uuid.UUID
	if zoneParam := c.QueryParam("zone"); zoneParam != "" {
		parsed, err := uuid.Parse(zoneParam)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
		}
		zone, err := h.Store.GetEventZoneByID(c.Request().Context(), parsed)
		if err != nil || zone == nil || zone.EventID != eventID {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
		}
		zoneID = &parsed
	}

	stats, err := h.Store.GetEventStats(c.Request().Context(), eventID, zoneID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load stats"})
	}
	return c.JSON(http.StatusOK, stats)
}
