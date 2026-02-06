package handler

import (
	"idento/backend/internal/models"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type BulkAttendeeRequest struct {
	Attendees   []map[string]interface{} `json:"attendees"`
	FieldSchema []string                 `json:"field_schema"` // List of all fields from CSV
}

type DuplicateInfo struct {
	Email     string `json:"email"`
	Code      string `json:"code,omitempty"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Reason    string `json:"reason"` // "email" or "code"
}

type BulkImportResponse struct {
	Message    string          `json:"message"`
	Created    int             `json:"created"`
	Skipped    int             `json:"skipped"`
	Total      int             `json:"total"`
	Duplicates []DuplicateInfo `json:"duplicates,omitempty"`
}

// BulkCreateAttendees creates multiple attendees at once (CSV import)
func (h *Handler) BulkCreateAttendees(c echo.Context) error {
	eventIDStr := c.Param("event_id")
	eventID, err := uuid.Parse(eventIDStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid event ID")
	}

	var req BulkAttendeeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if len(req.Attendees) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "No attendees provided")
	}

	// Get user claims
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid token")
	}

	// Verify event belongs to tenant
	event, err := h.Store.GetEventByID(c.Request().Context(), eventID)
	if err != nil || event == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Event not found")
	}
	if event.TenantID != tenantID {
		return echo.NewHTTPError(http.StatusForbidden, "Access denied")
	}

	// Update event field schema if provided
	if len(req.FieldSchema) > 0 {
		event.FieldSchema = req.FieldSchema
		if err := h.Store.UpdateEvent(c.Request().Context(), event); err != nil {
			c.Logger().Errorf("Failed to update event field schema: %v", err)
		}
	}

	// Get existing attendees to check for duplicates
	existingAttendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID)
	if err != nil {
		c.Logger().Errorf("Failed to get existing attendees: %v", err)
		// Continue anyway, we'll rely on DB constraints
		existingAttendees = []*models.Attendee{}
	}

	// Build maps for duplicate detection
	existingEmails := make(map[string]bool)
	existingCodes := make(map[string]bool)
	for _, att := range existingAttendees {
		if att.Email != "" {
			existingEmails[strings.ToLower(att.Email)] = true
		}
		if att.Code != "" {
			existingCodes[strings.ToUpper(att.Code)] = true
		}
	}

	// Known standard fields
	standardFields := map[string]bool{
		"first_name": true,
		"last_name":  true,
		"email":      true,
		"company":    true,
		"position":   true,
		"code":       true,
	}

	// Create attendees with duplicate checking
	createdCount := 0
	skippedCount := 0
	duplicates := []DuplicateInfo{}

	for _, rowData := range req.Attendees {
		attendee := &models.Attendee{
			ID:           uuid.New(),
			EventID:      eventID,
			CustomFields: make(map[string]interface{}),
		}

		// Map fields
		for key, value := range rowData {
			keyLower := strings.ToLower(key)

			if standardFields[keyLower] {
				// Map to standard fields
				switch keyLower {
				case "first_name":
					if str, ok := value.(string); ok {
						attendee.FirstName = str
					}
				case "last_name":
					if str, ok := value.(string); ok {
						attendee.LastName = str
					}
				case "email":
					if str, ok := value.(string); ok {
						attendee.Email = str
					}
				case "company":
					if str, ok := value.(string); ok {
						attendee.Company = str
					}
				case "position":
					if str, ok := value.(string); ok {
						attendee.Position = str
					}
				case "code":
					if str, ok := value.(string); ok && str != "" {
						attendee.Code = strings.ToUpper(str)
					}
				}
			}

			// Store all fields in custom_fields
			attendee.CustomFields[key] = value
		}

		// Generate code if not provided
		if attendee.Code == "" {
			// Generate unique code
			for {
				attendee.Code = strings.ToUpper(uuid.New().String()[:8])
				if !existingCodes[attendee.Code] {
					break
				}
			}
		}

		// Check for duplicates
		isDuplicate := false
		duplicateReason := ""

		if attendee.Email != "" && existingEmails[strings.ToLower(attendee.Email)] {
			isDuplicate = true
			duplicateReason = "email"
		} else if existingCodes[strings.ToUpper(attendee.Code)] {
			isDuplicate = true
			duplicateReason = "code"
		}

		if isDuplicate {
			// Skip duplicate
			duplicates = append(duplicates, DuplicateInfo{
				Email:     attendee.Email,
				Code:      attendee.Code,
				FirstName: attendee.FirstName,
				LastName:  attendee.LastName,
				Reason:    duplicateReason,
			})
			skippedCount++
			c.Logger().Infof("Skipping duplicate attendee: %s %s (%s) - reason: %s",
				attendee.FirstName, attendee.LastName, attendee.Email, duplicateReason)
			continue
		}

		// Create attendee
		if err := h.Store.CreateAttendee(c.Request().Context(), attendee); err != nil {
			c.Logger().Errorf("Failed to create attendee: %v", err)
			skippedCount++
			continue
		}

		// Add to tracking maps
		if attendee.Email != "" {
			existingEmails[strings.ToLower(attendee.Email)] = true
		}
		existingCodes[strings.ToUpper(attendee.Code)] = true

		createdCount++
	}

	response := BulkImportResponse{
		Message:    "Bulk import completed",
		Created:    createdCount,
		Skipped:    skippedCount,
		Total:      len(req.Attendees),
		Duplicates: duplicates,
	}

	return c.JSON(http.StatusCreated, response)
}
