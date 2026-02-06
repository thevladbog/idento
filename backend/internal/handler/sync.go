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
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
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
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	var req SyncPushRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	// Process attendee updates (most common use case: checking in)
	for _, attendee := range req.Changes.Attendees.Updated {
		// Verify attendee belongs to tenant's events
		existingAttendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendee.ID)
		if err != nil || existingAttendee == nil {
			continue // Skip if not found
		}

		// Get event to verify tenant
		event, err := h.Store.GetEventByID(c.Request().Context(), existingAttendee.EventID)
		if err != nil || event == nil || event.TenantID != tenantID {
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
	}

	// Process created attendees (if mobile app allows creating new attendees)
	for _, attendee := range req.Changes.Attendees.Created {
		// Verify event belongs to tenant
		event, err := h.Store.GetEventByID(c.Request().Context(), attendee.EventID)
		if err != nil || event == nil || event.TenantID != tenantID {
			continue
		}

		if err := h.Store.CreateAttendee(c.Request().Context(), &attendee); err != nil {
			continue
		}
	}

	// Process deletions (soft delete)
	// Not implemented in MVP

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now().UnixMilli(),
	})
}
