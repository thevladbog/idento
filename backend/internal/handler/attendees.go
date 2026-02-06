package handler

import (
	"idento/backend/internal/models"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type CreateAttendeeRequest struct {
	FirstName    string                 `json:"first_name"`
	LastName     string                 `json:"last_name"`
	Email        string                 `json:"email"`
	Company      string                 `json:"company"`
	Position     string                 `json:"position"`
	Code         string                 `json:"code"`
	CustomFields map[string]interface{} `json:"custom_fields"`
}

type UpdateAttendeeRequest struct {
	FirstName    *string                `json:"first_name,omitempty"`
	LastName     *string                `json:"last_name,omitempty"`
	Email        *string                `json:"email,omitempty"`
	Company      *string                `json:"company,omitempty"`
	Position     *string                `json:"position,omitempty"`
	Code         *string                `json:"code,omitempty"`
	Blocked      *bool                  `json:"blocked,omitempty"`
	CustomFields map[string]interface{} `json:"custom_fields,omitempty"`
}

func (h *Handler) CreateAttendee(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	req := new(CreateAttendeeRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Validate Event belongs to Tenant (security check)
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), eventID)
	if err != nil || event == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Event not found"})
	}
	if event.TenantID != tenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}

	attendee := &models.Attendee{
		EventID:      eventID,
		FirstName:    req.FirstName,
		LastName:     req.LastName,
		Email:        req.Email,
		Company:      req.Company,
		Position:     req.Position,
		Code:         req.Code,
		CustomFields: req.CustomFields,
	}

	if attendee.Code == "" {
		attendee.Code = uuid.New().String() // Generate simple code if missing
	}

	if err := h.Store.CreateAttendee(c.Request().Context(), attendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create attendee"})
	}

	// Log usage (best-effort, do not fail request)
	_ = h.Store.LogUsage(c.Request().Context(), &models.UsageLog{
		TenantID:     tenantID,
		ResourceType: "attendee",
		ResourceID:   &attendee.ID,
		Action:       "created",
		Quantity:     1,
	})

	return c.JSON(http.StatusCreated, attendee)
}

func (h *Handler) GetAttendees(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	attendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID)
	if err != nil {
		c.Logger().Error("Failed to fetch attendees: ", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch attendees"})
	}

	return c.JSON(http.StatusOK, attendees)
}

// UpdateAttendee - full update of attendee information
func (h *Handler) UpdateAttendeeInfo(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	// Get existing attendee
	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendeeID)
	if err != nil || attendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	// Security check: ensure the user has access to this event
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), attendee.EventID)
	if err != nil || event == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Event not found"})
	}
	if event.TenantID != tenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}

	// Bind update request
	var req UpdateAttendeeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Update fields
	if req.FirstName != nil {
		attendee.FirstName = *req.FirstName
	}
	if req.LastName != nil {
		attendee.LastName = *req.LastName
	}
	if req.Email != nil {
		attendee.Email = *req.Email
	}
	if req.Company != nil {
		attendee.Company = *req.Company
	}
	if req.Position != nil {
		attendee.Position = *req.Position
	}
	if req.Code != nil {
		attendee.Code = *req.Code
	}
	if req.Blocked != nil {
		attendee.Blocked = *req.Blocked
	}
	if req.CustomFields != nil {
		attendee.CustomFields = req.CustomFields
	}

	attendee.UpdatedAt = time.Now()

	if err := h.Store.UpdateAttendee(c.Request().Context(), attendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update attendee"})
	}

	return c.JSON(http.StatusOK, attendee)
}

// UpdateAttendeeHandler - for check-in status updates (backward compatibility)
func (h *Handler) UpdateAttendeeHandler(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	// Get existing attendee
	existingAttendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendeeID)
	if err != nil || existingAttendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	// Bind update request
	var req struct {
		CheckinStatus bool       `json:"checkin_status"`
		CheckedInAt   *time.Time `json:"checked_in_at"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Get current user from JWT token
	user := c.Get("user").(*models.JWTCustomClaims)
	userID, err := uuid.Parse(user.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	// Update fields
	existingAttendee.CheckinStatus = req.CheckinStatus

	// Set CheckedInAt automatically when checking in
	if req.CheckinStatus {
		// If CheckedInAt provided, use it; otherwise set current time
		if req.CheckedInAt != nil {
			existingAttendee.CheckedInAt = req.CheckedInAt
		} else if existingAttendee.CheckedInAt == nil {
			// Only set if not already checked in
			now := time.Now()
			existingAttendee.CheckedInAt = &now
		}

		// Track who checked in the attendee (only on first check-in)
		if existingAttendee.CheckedInBy == nil {
			existingAttendee.CheckedInBy = &userID
			// Get user email from DB and store it
			if checkinUser, err := h.Store.GetUserByID(c.Request().Context(), userID); err == nil && checkinUser != nil {
				existingAttendee.CheckedInByEmail = &checkinUser.Email
			}
		}
	} else {
		// Uncheck - clear the check-in data
		existingAttendee.CheckedInAt = nil
		existingAttendee.CheckedInBy = nil
		existingAttendee.CheckedInByEmail = nil
	}

	existingAttendee.UpdatedAt = time.Now()

	if err := h.Store.UpdateAttendee(c.Request().Context(), existingAttendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update attendee"})
	}

	return c.JSON(http.StatusOK, existingAttendee)
}

// BlockAttendee - block attendee with reason
func (h *Handler) BlockAttendee(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	var req struct {
		Reason string `json:"reason"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendeeID)
	if err != nil || attendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	// Security check
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), attendee.EventID)
	if err != nil || event == nil || event.TenantID != tenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}

	// Block attendee with reason
	attendee.Blocked = true
	attendee.BlockReason = &req.Reason
	attendee.UpdatedAt = time.Now()

	if err := h.Store.UpdateAttendee(c.Request().Context(), attendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update attendee"})
	}

	return c.JSON(http.StatusOK, attendee)
}

// UnblockAttendee - unblock attendee
func (h *Handler) UnblockAttendee(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendeeID)
	if err != nil || attendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	// Security check
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), attendee.EventID)
	if err != nil || event == nil || event.TenantID != tenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}

	// Unblock attendee
	attendee.Blocked = false
	attendee.BlockReason = nil
	attendee.UpdatedAt = time.Now()

	if err := h.Store.UpdateAttendee(c.Request().Context(), attendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update attendee"})
	}

	return c.JSON(http.StatusOK, attendee)
}

// DeleteAttendee - soft delete attendee
func (h *Handler) DeleteAttendee(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	attendee, err := h.Store.GetAttendeeByID(c.Request().Context(), attendeeID)
	if err != nil || attendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	// Security check
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), attendee.EventID)
	if err != nil || event == nil || event.TenantID != tenantID {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}

	// Soft delete
	now := time.Now()
	attendee.DeletedAt = &now

	if err := h.Store.UpdateAttendee(c.Request().Context(), attendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete attendee"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Attendee deleted successfully"})
}
