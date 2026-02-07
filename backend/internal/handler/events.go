package handler

import (
	"fmt"
	"idento/backend/internal/models"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type CreateEventRequest struct {
	Name      string     `json:"name"`
	StartDate *time.Time `json:"start_date"`
	EndDate   *time.Time `json:"end_date"`
	Location  string     `json:"location"`
}

func (h *Handler) CreateEvent(c echo.Context) error {
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token claims"})
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
		fmt.Printf("Failed to log usage: %v\n", err)
	}

	return c.JSON(http.StatusCreated, event)
}

func (h *Handler) GetEvents(c echo.Context) error {
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token claims"})
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

	event, err := h.Store.GetEventByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch event"})
	}

	// Security: Check if event belongs to tenant
	user := c.Get("user").(*models.JWTCustomClaims)
	if event.TenantID.String() != user.TenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
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

	// Get existing event
	event, err := h.Store.GetEventByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch event"})
	}

	// Security: Check if event belongs to tenant
	user := c.Get("user").(*models.JWTCustomClaims)
	if event.TenantID.String() != user.TenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
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
