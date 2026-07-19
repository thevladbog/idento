package handler

import (
	"idento/backend/internal/models"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type SyncPullResponse struct {
	Changes   SyncChanges `json:"changes"`
	Timestamp int64       `json:"timestamp"`
}

type SyncChanges struct {
	Events    SyncEntityChanges `json:"events"`
	Attendees SyncEntityChanges `json:"attendees"`
}

type SyncEntityChanges struct {
	Created []interface{} `json:"created"`
	Updated []interface{} `json:"updated"`
	Deleted []string      `json:"deleted"`
}

type SyncPushRequest struct {
	Changes      SyncPushChanges `json:"changes"`
	LastPulledAt int64           `json:"lastPulledAt"`
}

type SyncPushChanges struct {
	Attendees SyncPushEntityChanges `json:"attendees"`
}

type SyncPushEntityChanges struct {
	Created []models.Attendee `json:"created"`
	Updated []models.Attendee `json:"updated"`
	Deleted []string          `json:"deleted"`
}

func (h *Handler) SyncPull(c echo.Context) error {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	lastPulledAtRaw := c.QueryParam("last_pulled_at")
	var lastPulledAt time.Time

	if lastPulledAtRaw != "" && lastPulledAtRaw != "null" {
		ts, err := strconv.ParseInt(lastPulledAtRaw, 10, 64)
		if err == nil {
			lastPulledAt = time.Unix(ts/1000, 0) // JS timestamp is ms
		}
	}

	// 1. Fetch changed events
	events, err := h.Store.GetEventsChangedSince(c.Request().Context(), tenantID, lastPulledAt)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to sync events"})
	}

	// 2. Fetch changed attendees
	attendees, err := h.Store.GetAttendeesChangedSince(c.Request().Context(), tenantID, lastPulledAt)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to sync attendees"})
	}

	// 3. Format response
	changes := SyncChanges{
		Events: SyncEntityChanges{
			Created: make([]interface{}, 0),
			Updated: make([]interface{}, 0),
			Deleted: make([]string, 0),
		},
		Attendees: SyncEntityChanges{
			Created: make([]interface{}, 0),
			Updated: make([]interface{}, 0),
			Deleted: make([]string, 0),
		},
	}

	for _, e := range events {
		if lastPulledAt.IsZero() {
			changes.Events.Created = append(changes.Events.Created, e)
		} else {
			changes.Events.Updated = append(changes.Events.Updated, e)
		}
	}

	for _, a := range attendees {
		if lastPulledAt.IsZero() {
			changes.Attendees.Created = append(changes.Attendees.Created, a)
		} else {
			changes.Attendees.Updated = append(changes.Attendees.Updated, a)
		}
	}

	return c.JSON(http.StatusOK, SyncPullResponse{
		Changes:   changes,
		Timestamp: time.Now().UnixMilli(),
	})
}

func (h *Handler) SyncPush(c echo.Context) error {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	var req SyncPushRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	// affectedEvents collects the distinct events touched by a successful
	// attendee update below (Finding B3, PR #81 bot-review round): unlike
	// checkins_batch.go, sync pushes are per-attendee and can span MULTIPLE
	// events in one request, so a single publish keyed on some fixed
	// event_id would be wrong — every distinct event that had at least one
	// successfully-updated attendee gets exactly one publish, issued once
	// the whole push finishes (not once per attendee). This legacy write
	// path mutates attendees.checkin_status via UpdateAttendee but never
	// published to the monitor broker before — a mobile-kiosk-only event
	// (zero panel check-in stations, so zero heartbeats either) would leave
	// attached monitors stale indefinitely.
	affectedEvents := make(map[uuid.UUID]struct{})

	// Process attendee updates (most common use case: checking in)
	for _, attendee := range req.Changes.Attendees.Updated {
		// Verify attendee belongs to tenant's events
		existingAttendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendee.ID)
		if err != nil || existingAttendee == nil {
			continue // Skip if not found
		}

		// Get event to verify tenant
		event, err := h.Store.GetEventByIDForTenant(c.Request().Context(), existingAttendee.EventID, tenantID)
		if err != nil || event == nil {
			continue // Skip if event doesn't belong to tenant
		}

		// Conflict resolution: Last Write Wins
		// If server's updated_at > client's, server wins (skip update)
		// For simplicity, we always accept client updates in this MVP
		// In production, you'd compare timestamps

		// Update attendee
		if err := h.Store.UpdateAttendee(c.Request().Context(), &attendee); err != nil {
			// Log error but continue with other updates
			continue
		}

		// existingAttendee.EventID (not the client-supplied attendee.EventID)
		// is the trusted, already-tenant-verified event this write belongs to.
		affectedEvents[existingAttendee.EventID] = struct{}{}
	}

	// Process created attendees (if mobile app allows creating new attendees)
	//
	// P1.3: offline-created attendees must respect attendees_per_event just
	// like the JWT-authed bulk-create and API-key import paths — otherwise a
	// mobile client can bypass the plan's limit simply by queueing creations
	// offline and pushing them through sync. We first resolve ownership per
	// item (so foreign-tenant events are skipped as before), then group the
	// surviving creations by event and check the limit once per event for
	// the whole batch size, so a request can't dodge the limit by hiding
	// several creations for the same event under one sync push.
	type pendingCreate struct {
		attendee *models.Attendee
		eventID  uuid.UUID
	}
	var pending []pendingCreate
	countByEvent := make(map[uuid.UUID]int)
	for i := range req.Changes.Attendees.Created {
		attendee := &req.Changes.Attendees.Created[i]

		// Verify event belongs to tenant
		event, err := h.Store.GetEventByIDForTenant(c.Request().Context(), attendee.EventID, tenantID)
		if err != nil || event == nil {
			continue
		}

		pending = append(pending, pendingCreate{attendee: attendee, eventID: attendee.EventID})
		countByEvent[attendee.EventID]++
	}

	blockedEvents := make(map[uuid.UUID]bool, len(countByEvent))
	for eventID, adding := range countByEvent {
		allowed, _, _, err := h.Store.CheckAttendeeLimit(c.Request().Context(), tenantID, eventID, adding)
		if err != nil {
			c.Logger().Errorf("sync: attendee limit check failed (tenant %s, event %s): %v — failing closed", tenantID, eventID, err)
		}
		if err != nil || !allowed {
			blockedEvents[eventID] = true
		}
	}

	for _, p := range pending {
		if blockedEvents[p.eventID] {
			continue // event is at/over attendees_per_event; skip silently like other sync guards
		}
		if err := h.Store.CreateAttendee(c.Request().Context(), p.attendee); err != nil {
			c.Logger().Errorf("sync: create attendee failed (tenant %s, event %s, attendee %s): %v", tenantID, p.eventID, p.attendee.ID, err)
			continue
		}
		// Track successfully-created attendees' events for monitor publish,
		// same as Updated attendees above: created attendees also change
		// monitor-visible state (total count, and possibly checked_in if an
		// offline kiosk created-and-checked-in in one push).
		affectedEvents[p.eventID] = struct{}{}
	}

	// Process deletions (soft delete)
	// Not implemented in MVP

	// Finding B3: one publish per distinct affected event, after the whole
	// push finishes — see affectedEvents' doc comment above.
	for eventID := range affectedEvents {
		h.publishCheckinEvent(c.Request().Context(), eventID)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now().UnixMilli(),
	})
}
