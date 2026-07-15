package handler

import (
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CreateAttendeeRequest is the JSON body for POST /api/events/:event_id/attendees.
type CreateAttendeeRequest struct {
	FirstName    string                 `json:"first_name"`
	LastName     string                 `json:"last_name"`
	Email        string                 `json:"email"`
	Company      string                 `json:"company"`
	Position     string                 `json:"position"`
	Code         string                 `json:"code"`
	CustomFields map[string]interface{} `json:"custom_fields"`
}

// UpdateAttendeeRequest is the JSON body for PATCH /api/attendees/:id (full info update).
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

// CreateAttendee creates an attendee for the given event; returns 400/404/500 on error.
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
	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}
	tenantID := event.TenantID

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
	if err := h.Store.LogUsage(c.Request().Context(), &models.UsageLog{
		TenantID:     tenantID,
		ResourceType: "attendee",
		ResourceID:   &attendee.ID,
		Action:       "created",
		Quantity:     1,
	}); err != nil {
		// Log error but don't fail the request
		log.Printf("Failed to log usage: %v", err)
	}

	return c.JSON(http.StatusCreated, attendee)
}

// GetAttendees lists attendees for an event, optionally filtered by an exact
// `code` match (used by mobile QR/barcode scan lookup) and/or a `search`
// substring match across name/email/code (used by mobile attendee search).
//
// Back-compat is non-negotiable: mobile clients consume today's bare-array
// response. The envelope response ({"attendees": [...], "total", "page",
// "per_page"}) appears ONLY when the `page` or `per_page` query param is
// present; without them, the response is the unchanged legacy bare array
// (code/search still apply as before). When either pagination param is
// present, `zone` (an event zone UUID; matches attendees with an explicit
// attendee_zone_access allowed=true row for that zone) and `status`
// (checked_in|not_checked_in) additionally narrow the result, and `page`
// defaults to 1 / `per_page` defaults to 50 when only one of the pair is
// given.
func (h *Handler) GetAttendees(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	code := c.QueryParam("code")
	search := c.QueryParam("search")
	pageParam := c.QueryParam("page")
	perPageParam := c.QueryParam("per_page")

	if pageParam == "" && perPageParam == "" {
		attendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID, code, search)
		if err != nil {
			c.Logger().Error("Failed to fetch attendees: ", err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch attendees"})
		}
		return c.JSON(http.StatusOK, attendees)
	}

	page := 1
	if pageParam != "" {
		p, err := strconv.Atoi(pageParam)
		if err != nil || p < 1 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "page must be a positive integer"})
		}
		page = p
	}

	perPage := 50
	if perPageParam != "" {
		pp, err := strconv.Atoi(perPageParam)
		if err != nil || pp < 1 || pp > 200 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "per_page must be between 1 and 200"})
		}
		perPage = pp
	}

	filter := store.AttendeeFilter{
		Code:    code,
		Search:  search,
		Page:    page,
		PerPage: perPage,
	}

	if zoneParam := c.QueryParam("zone"); zoneParam != "" {
		zoneID, err := uuid.Parse(zoneParam)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "zone must be a valid UUID"})
		}
		filter.ZoneID = &zoneID
	}

	if statusParam := c.QueryParam("status"); statusParam != "" {
		switch statusParam {
		case "checked_in":
			checkedIn := true
			filter.Status = &checkedIn
		case "not_checked_in":
			notCheckedIn := false
			filter.Status = &notCheckedIn
		default:
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "status must be checked_in or not_checked_in"})
		}
	}

	attendees, total, err := h.Store.GetAttendeesPage(c.Request().Context(), eventID, filter)
	if err != nil {
		c.Logger().Error("Failed to fetch attendees: ", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch attendees"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"attendees": attendees,
		"total":     total,
		"page":      page,
		"per_page":  perPage,
	})
}

// UpdateAttendee - full update of attendee information
func (h *Handler) UpdateAttendeeInfo(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
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

	existingAttendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
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
	user, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
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

	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
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

	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
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

	attendee, err := h.requireAttendeeOwnership(c, attendeeID)
	if err != nil {
		return writeErr(c, err)
	}

	// Soft delete
	now := time.Now()
	attendee.DeletedAt = &now

	if err := h.Store.UpdateAttendee(c.Request().Context(), attendee); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete attendee"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Attendee deleted successfully"})
}
