package handler

import (
	"net/http"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

var validOverrideContexts = map[string]bool{
	"already_checked": true,
	"not_registered":  true,
	"no_access":       true,
}

// CreateCheckinOverride records an audit-logged staff override ("Всё равно
// пропустить") for an already-checked / not-registered / no-access verdict.
func (h *Handler) CreateCheckinOverride(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req models.CreateCheckinOverrideRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if !validOverrideContexts[req.Context] {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid context"})
	}

	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), req.AttendeeID)
	if err != nil || attendee == nil || attendee.EventID != eventID {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}
	if req.ZoneID != nil {
		zone, err := h.Store.GetEventZoneByID(c.Request().Context(), *req.ZoneID)
		if err != nil || zone == nil || zone.EventID != eventID {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
		}
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	staffUserID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	override := &models.CheckinOverride{
		AttendeeID:  req.AttendeeID,
		ZoneID:      req.ZoneID,
		Context:     req.Context,
		StaffUserID: staffUserID,
	}
	if err := h.Store.CreateCheckinOverride(c.Request().Context(), override); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to log override"})
	}
	return c.JSON(http.StatusCreated, override)
}
