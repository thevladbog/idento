package handler

import (
	"errors"
	"net/http"
	"strings"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CheckinStationRegisterRequest is the request body for POST
// /api/events/{event_id}/checkin-stations. Name identifies the station
// (UNIQUE per event, enforced by the checkin_stations table) —
// registering the SAME name again is an upsert (see
// store.UpsertCheckinStation), never a duplicate. ZoneID, when present,
// must belong to the same event (validated against
// GetEventZoneByID before the store call).
type CheckinStationRegisterRequest struct {
	Name   string     `json:"name"`
	ZoneID *uuid.UUID `json:"zone_id,omitempty"`
}

// CheckinStationResponse is the response envelope for POST
// /api/events/{event_id}/checkin-stations.
type CheckinStationResponse struct {
	Station *models.CheckinStation `json:"station"`
}

// CheckinStationListResponse is the response envelope for GET
// /api/events/{event_id}/checkin-stations.
type CheckinStationListResponse struct {
	Stations []*models.CheckinStation `json:"stations"`
}

// RegisterCheckinStation upserts a named check-in station for an event
// (P4.1 Task 2): a fresh name creates a new station; re-registering the
// SAME name updates its zone binding and refreshes last_seen_at rather
// than erroring or creating a duplicate row.
func (h *Handler) RegisterCheckinStation(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ownership first (badge_template/checkin_settings precedent): a
	// deleted/foreign event must be a 404, not a misleading 500 or a
	// station silently registered against someone else's event.
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	var req CheckinStationRegisterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	// Trim before both the emptiness check and persistence (super_admin.go
	// CreateTenant precedent): the UNIQUE(event_id, name) upsert must key on
	// the same name regardless of incidental leading/trailing whitespace —
	// otherwise " Main Entrance" and "Main Entrance" would silently create
	// two stations instead of one being re-registered.
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}

	if req.ZoneID != nil {
		zone, err := h.Store.GetEventZoneByID(c.Request().Context(), *req.ZoneID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify zone"})
		}
		if zone == nil || zone.EventID != eventID {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Zone not found in event"})
		}
	}

	station, err := h.Store.UpsertCheckinStation(c.Request().Context(), eventID, name, req.ZoneID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to register check-in station"})
	}

	return c.JSON(http.StatusOK, CheckinStationResponse{Station: station})
}

// HeartbeatCheckinStation refreshes a check-in station's last_seen_at
// (P4.1 Task 2), scoped to the event in the path so a station id from a
// different event can never be touched.
func (h *Handler) HeartbeatCheckinStation(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	stationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid station ID"})
	}

	if err := h.Store.HeartbeatCheckinStation(c.Request().Context(), eventID, stationID); err != nil {
		if errors.Is(err, store.ErrCheckinStationNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Check-in station not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update check-in station"})
	}

	return c.NoContent(http.StatusNoContent)
}

// ListCheckinStations returns every check-in station registered for an
// event (P4.1 Task 2).
func (h *Handler) ListCheckinStations(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	stations, err := h.Store.ListCheckinStations(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list check-in stations"})
	}
	if stations == nil {
		stations = []*models.CheckinStation{}
	}

	return c.JSON(http.StatusOK, CheckinStationListResponse{Stations: stations})
}
