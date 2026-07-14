package handler

import (
	"idento/backend/internal/models"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CreateEventRequest is the JSON body for POST /api/events.
type CreateEventRequest struct {
	Name      string     `json:"name"`
	StartDate *time.Time `json:"start_date"`
	EndDate   *time.Time `json:"end_date"`
	Location  string     `json:"location"`
}

// CreateEvent creates an event for the tenant from JWT; returns 400/500 on error.
func (h *Handler) CreateEvent(c echo.Context) error {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	req := new(CreateEventRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	event := &models.Event{
		TenantID:  tenantID,
		Name:      req.Name,
		StartDate: req.StartDate,
		EndDate:   req.EndDate,
		Location:  req.Location,
	}

	if err := h.Store.CreateEvent(c.Request().Context(), event); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create event"})
	}

	// Log usage
	if err := h.Store.LogUsage(c.Request().Context(), &models.UsageLog{
		TenantID:     tenantID,
		ResourceType: "event",
		ResourceID:   &event.ID,
		Action:       "created",
		Quantity:     1,
	}); err != nil {
		// Log error but don't fail the request
		log.Printf("Failed to log usage: %v", err)
	}

	return c.JSON(http.StatusCreated, event)
}

func (h *Handler) GetEvents(c echo.Context) error {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	events, err := h.Store.GetEventsByTenantID(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch events"})
	}

	return c.JSON(http.StatusOK, events)
}

func (h *Handler) GetEvent(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	event, err := h.requireEventOwnership(c, id)
	if err != nil {
		return writeErr(c, err)
	}
	return c.JSON(http.StatusOK, event)
}

type UpdateEventRequest struct {
	Name         string                 `json:"name"`
	StartDate    *time.Time             `json:"start_date"`
	EndDate      *time.Time             `json:"end_date"`
	Location     string                 `json:"location"`
	FieldSchema  []string               `json:"field_schema"`
	CustomFields map[string]interface{} `json:"custom_fields"`
}

func (h *Handler) UpdateEvent(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	event, err := h.requireEventOwnership(c, id)
	if err != nil {
		return writeErr(c, err)
	}

	// Bind update request
	req := new(UpdateEventRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Update event fields
	event.Name = req.Name
	event.StartDate = req.StartDate
	event.EndDate = req.EndDate
	event.Location = req.Location
	event.FieldSchema = req.FieldSchema
	event.CustomFields = req.CustomFields

	if err := h.Store.UpdateEvent(c.Request().Context(), event); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update event"})
	}

	return c.JSON(http.StatusOK, event)
}

// PatchEventRequest carries optional fields; nil pointer = leave unchanged.
// custom_fields is intentionally absent: it stores the badge template and
// is only writable through the badge editor's own save path (P3).
type PatchEventRequest struct {
	Name        *string    `json:"name"`
	StartDate   *time.Time `json:"start_date"`
	EndDate     *time.Time `json:"end_date"`
	Location    *string    `json:"location"`
	FieldSchema []string   `json:"field_schema"`
}

// PatchEvent applies a partial update: only non-nil fields change.
func (h *Handler) PatchEvent(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	event, err := h.requireEventOwnership(c, id)
	if err != nil {
		return writeErr(c, err)
	}
	req := new(PatchEventRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}
	if req.Name != nil {
		event.Name = *req.Name
	}
	if req.StartDate != nil {
		event.StartDate = req.StartDate
	}
	if req.EndDate != nil {
		event.EndDate = req.EndDate
	}
	if req.Location != nil {
		event.Location = *req.Location
	}
	if req.FieldSchema != nil {
		event.FieldSchema = req.FieldSchema
	}
	if err := h.Store.UpdateEvent(c.Request().Context(), event); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update event"})
	}
	return c.JSON(http.StatusOK, event)
}

// DeleteEvent soft-deletes an event (deleted_at); GetEvents/GetEventByID
// already exclude soft-deleted rows, so it vanishes from all listings.
func (h *Handler) DeleteEvent(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, id); err != nil {
		return writeErr(c, err)
	}
	if err := h.Store.SoftDeleteEvent(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete event"})
	}
	return c.NoContent(http.StatusNoContent)
}
