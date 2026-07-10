package handler

import (
	"idento/backend/internal/models"
	"idento/backend/internal/zpl"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// BadgeZPLRequest is the JSON body for POST /api/events/:eventId/badge-zpl.
type BadgeZPLRequest struct {
	AttendeeID string `json:"attendee_id"`
}

// BadgeZPLResponse is the response with generated ZPL.
type BadgeZPLResponse struct {
	ZPL string `json:"zpl"`
}

// attendeeToData builds a flat map for template substitution (first_name, last_name, code, etc. + custom_fields).
func attendeeToData(a *models.Attendee) map[string]interface{} {
	data := map[string]interface{}{
		"id":         a.ID.String(),
		"first_name": a.FirstName,
		"last_name":  a.LastName,
		"email":      a.Email,
		"company":    a.Company,
		"position":   a.Position,
		"code":       a.Code,
	}
	if a.CustomFields != nil {
		for k, v := range a.CustomFields {
			if _, ok := data[k]; ok {
				continue // avoid overwriting standard attendee keys
			}
			data[k] = v
		}
	}
	return data
}

// BadgeZPL generates ready ZPL for a badge (event template + attendee data) and returns it.
func (h *Handler) BadgeZPL(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	req := new(BadgeZPLRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}
	if req.AttendeeID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "attendee_id is required"})
	}

	attendeeID, err := uuid.Parse(req.AttendeeID)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee_id"})
	}

	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}
	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
	}
	if attendee.EventID != eventID {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Attendee does not belong to this event"})
	}

	rawTemplate := event.CustomFields["badgeTemplate"]
	cfg, elements, err := zpl.ParseBadgeTemplate(rawTemplate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid badge template: " + err.Error()})
	}

	data := attendeeToData(attendee)
	out := zpl.Generate(cfg, elements, data)

	return c.JSON(http.StatusOK, BadgeZPLResponse{ZPL: out})
}
