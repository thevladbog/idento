package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
		// A non-existent zone_id surfaces pgx.ErrNoRows from the store (it
		// does not normalize no-rows to (nil, nil)) — fold that into the
		// same 400 "not found" branch as a real row belonging to a
		// different event (checkins_override.go / checkins_batch.go
		// precedent), while still surfacing a genuine unexpected DB error
		// as 500.
		zone, err := h.Store.GetEventZoneByID(c.Request().Context(), *req.ZoneID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
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

	// Publish on every successful heartbeat (P4.2 Task 4, self-review
	// notes): unlike check-in/undo/reprint, a heartbeat's ONLY effect is
	// bumping last_seen_at — but the monitor's stations card renders that
	// exact field (liveness dot + staleness), so it IS monitor-visible
	// state and every 204 here is worth a signal. publishCheckinEvent
	// (Finding B2) is nil-safe, best-effort, detached, timeout-bounded —
	// after the store call already committed. shouldPublishHeartbeat
	// (Finding B5) additionally throttles heartbeat-SOURCED publishes per
	// event — unlike check-in/undo/reprint, which stay unthrottled.
	if h.shouldPublishHeartbeat(eventID) {
		h.publishCheckinEvent(c.Request().Context(), eventID)
	}

	return c.NoContent(http.StatusNoContent)
}

// heartbeatPublishThrottle bounds how often a heartbeat-SOURCED publish can
// fire per event (Finding B5, CodeRabbit, PR #81 bot-review round): every
// station's heartbeat cadence is 20s (P4.1 Task 12 precedent), so N
// stations on a larger event would otherwise produce a near-continuous
// stream of update-pings — up to roughly 1/s on a busy event, each one
// costing every attached monitor a full snapshot re-fetch. 15s keeps
// heartbeat-driven staleness comfortably under the monitor's own 45s
// liveness threshold (P4.2 spec §3.2) while cutting the worst-case publish
// rate by roughly an order of magnitude. Check-in/undo/reprint publishes
// are user-visible state changes and stay completely unthrottled — this
// throttle gates ONLY HeartbeatCheckinStation's own publish, never touches
// broker.Broker itself (kept in the handler layer on purpose, per the
// finding). A package var, not a const, so
// checkin_stations_publish_test.go can shrink it to exercise the throttle
// window without a real 15-second wait — same idiom as monitor_stream.go's
// monitorStreamPingInterval.
var heartbeatPublishThrottle = 15 * time.Second

// shouldPublishHeartbeat reports whether a heartbeat-sourced publish for
// eventID is allowed right now, and if allowed atomically records this
// moment as eventID's new "last published" time in h.heartbeatLastPublish.
// The check-and-set is a single LoadOrStore/CompareAndSwap loop so two
// concurrent heartbeats for the same event (e.g. two different stations at
// the same event, both landing in the same instant) can't both slip through
// right at the window boundary — at most one of them ever wins the race and
// returns true.
func (h *Handler) shouldPublishHeartbeat(eventID uuid.UUID) bool {
	now := time.Now()
	for {
		v, loaded := h.heartbeatLastPublish.LoadOrStore(eventID, now)
		if !loaded {
			return true // first heartbeat ever observed for this event
		}
		last := v.(time.Time)
		if now.Sub(last) < heartbeatPublishThrottle {
			return false
		}
		if h.heartbeatLastPublish.CompareAndSwap(eventID, last, now) {
			return true
		}
		// Lost the race to another concurrent heartbeat that updated
		// eventID's timestamp in between our Load and this CompareAndSwap;
		// retry against the now-current value.
	}
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
