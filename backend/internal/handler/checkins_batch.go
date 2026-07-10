package handler

import (
	"net/http"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// BatchCheckin applies a batch of offline-queued check-ins/zone-entries
// idempotently (deduplicated by client_uuid), for mobile clients flushing
// their offline sync queue. Always returns 200 with a per-item result array —
// a single bad item does not fail the whole batch.
func (h *Handler) BatchCheckin(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var items []models.BatchCheckinItem
	if err := c.Bind(&items); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if len(items) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Empty batch"})
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	staffUserID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	results := make([]models.BatchCheckinResult, 0, len(items))
	for i := range items {
		item := items[i]

		attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), item.AttendeeID)
		if err != nil || attendee == nil || attendee.EventID != eventID {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "Attendee not found in event"})
			continue
		}

		if item.Kind == "zone_entry" {
			if item.ZoneID == nil {
				results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "zone_id is required for kind=zone_entry"})
				continue
			}
			zone, err := h.Store.GetEventZoneByID(c.Request().Context(), *item.ZoneID)
			if err != nil || zone == nil || zone.EventID != eventID {
				results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "Zone not found in event"})
				continue
			}
		} else if item.Kind != "checkin" {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: "Unknown kind"})
			continue
		}

		applied, err := h.Store.ApplyBatchCheckin(c.Request().Context(), eventID, staffUserID, &item)
		if err != nil {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "error", Error: err.Error()})
			continue
		}
		if applied {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "created"})
		} else {
			results = append(results, models.BatchCheckinResult{ClientUUID: item.ClientUUID, Status: "already_exists"})
		}
	}
	return c.JSON(http.StatusOK, results)
}
