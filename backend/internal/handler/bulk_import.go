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

type BulkRowError struct {
	Row     int    `json:"row"`
	Data    string `json:"data"`
	Problem string `json:"problem"`
}

type BulkImportResponse struct {
	Message    string          `json:"message"`
	Created    int             `json:"created"`
	Skipped    int             `json:"skipped"`
	Total      int             `json:"total"`
	Duplicates []DuplicateInfo `json:"duplicates,omitempty"`
	// Errors is always present (an empty array, never omitted/null, when
	// there are no per-row errors) — frontend consumers can rely on it
	// without a `?? []` fallback.
	Errors []BulkRowError `json:"errors"`
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

	// Verify event belongs to tenant
	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}

	// P1.3: validate the whole batch against attendees_per_event before inserting.
	allowed, current, max, err := h.Store.CheckAttendeeLimit(c.Request().Context(), event.TenantID, eventID, len(req.Attendees))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to check attendee limit")
	}
	if !allowed {
		return c.JSON(http.StatusForbidden, map[string]interface{}{
			"error":            "Limit exceeded for attendees_per_event",
			"current":          current,
			"max":              max,
			"adding":           len(req.Attendees),
			"upgrade_required": true,
			"limit_type":       "attendees_per_event",
		})
	}

	// Update event field schema if provided
	if len(req.FieldSchema) > 0 {
		event.FieldSchema = req.FieldSchema
		if err := h.Store.UpdateEvent(c.Request().Context(), event); err != nil {
			c.Logger().Errorf("Failed to update event field schema: %v", err)
		}
	}

	// Get existing attendees to check for duplicates
	existingAttendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID, "", "")
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
	errors := []BulkRowError{}

	for i, rowData := range req.Attendees {
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

		// Build data string for error reporting (first+last name, fallback to email, may be empty)
		errorData := strings.TrimSpace(attendee.FirstName + " " + attendee.LastName)
		if errorData == "" {
			errorData = attendee.Email
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
			// Track the error
			problem := "duplicate_email"
			if duplicateReason == "code" {
				problem = "duplicate_code"
			}
			errors = append(errors, BulkRowError{
				Row:     i + 1,
				Data:    errorData,
				Problem: problem,
			})
			skippedCount++
			c.Logger().Infof("Skipping duplicate attendee: %s %s (%s) - reason: %s",
				attendee.FirstName, attendee.LastName, attendee.Email, duplicateReason)
			continue
		}

		// Create attendee
		if err := h.Store.CreateAttendee(c.Request().Context(), attendee); err != nil {
			c.Logger().Errorf("Failed to create attendee: %v", err)
			errors = append(errors, BulkRowError{
				Row:     i + 1,
				Data:    errorData,
				Problem: "create_failed",
			})
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

	// PR #81 round-3 convergence, Backend Finding 3: a bulk import changes
	// the monitor's `total` exactly like a single CreateAttendee does, but
	// as ONE request creating N attendees — publish exactly ONCE for the
	// whole batch (never once per row), and only when at least one row
	// actually got created (an all-duplicate/all-error batch changed
	// nothing monitor-visible).
	if createdCount > 0 {
		h.publishCheckinEvent(c.Request().Context(), eventID)
		// P5.3.5: keep planner statistics fresh after a bulk write so the
		// very next attendee-list query (e.g. an organizer immediately
		// filtering by zone) doesn't hit the stale-statistics ~100x-slower
		// join-plan bug found during P5.3.5 planning. Logged, not fatal --
		// this is a performance optimization, never worth failing an
		// otherwise-successful import over.
		if err := h.Store.AnalyzeAttendeesTable(c.Request().Context()); err != nil {
			c.Logger().Warnf("bulk import: ANALYZE attendees failed (non-fatal): %v", err)
		}
	}

	response := BulkImportResponse{
		Message:    "Bulk import completed",
		Created:    createdCount,
		Skipped:    skippedCount,
		Total:      len(req.Attendees),
		Duplicates: duplicates,
		Errors:     errors,
	}

	return c.JSON(http.StatusCreated, response)
}
