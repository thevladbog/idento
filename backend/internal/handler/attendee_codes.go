package handler

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// GenerateAttendeeCodes generates unique codes for attendees without codes
func (h *Handler) GenerateAttendeeCodes(c echo.Context) error {
	eventIDStr := c.Param("event_id")
	eventID, err := uuid.Parse(eventIDStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ensure the user has access to this event
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	// Get all attendees for this event
	attendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get attendees"})
	}

	updatedCount := 0
	for _, attendee := range attendees {
		// Generate code if missing or empty
		if attendee.Code == "" {
			attendee.Code = generateUniqueCode()
			if err := h.Store.UpdateAttendee(c.Request().Context(), attendee); err != nil {
				c.Logger().Errorf("Failed to update attendee %s: %v", attendee.ID, err)
				continue
			}
			updatedCount++
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":        "success",
		"updated_count": updatedCount,
		"message":       fmt.Sprintf("Generated codes for %d attendees", updatedCount),
	})
}

// sanitizeCSVField neutralizes CSV/formula injection by prefixing a single
// quote to values starting with a formula trigger (OWASP CSV injection).
func sanitizeCSVField(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

// ExportAttendeesCSV exports attendees as CSV
func (h *Handler) ExportAttendeesCSV(c echo.Context) error {
	eventIDStr := c.Param("event_id")
	eventID, err := uuid.Parse(eventIDStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	// Ensure the user has access to this event
	event, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		return writeErr(c, err)
	}

	// Get all attendees
	attendees, err := h.Store.GetAttendeesByEventID(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get attendees"})
	}

	// Determine all fields (from field_schema + standard fields)
	allFields := make(map[string]bool)
	allFields["code"] = true
	allFields["first_name"] = true
	allFields["last_name"] = true
	allFields["email"] = true
	allFields["company"] = true
	allFields["position"] = true
	allFields["checkin_status"] = true

	// Add fields from schema
	for _, field := range event.FieldSchema {
		allFields[field] = true
	}

	// Add any custom fields from attendees
	for _, attendee := range attendees {
		for field := range attendee.CustomFields {
			allFields[field] = true
		}
	}

	// Create ordered list of fields
	var fieldOrder []string
	fieldOrder = append(fieldOrder, "code")

	// Add from schema if available
	if len(event.FieldSchema) > 0 {
		for _, field := range event.FieldSchema {
			if field != "code" {
				fieldOrder = append(fieldOrder, field)
			}
		}
	} else {
		// Default order
		fieldOrder = append(fieldOrder, "first_name", "last_name", "email", "company", "position")
	}

	fieldOrder = append(fieldOrder, "checkin_status")

	// Prepare CSV
	var csvData strings.Builder
	writer := csv.NewWriter(&csvData)

	// Write header (sanitized: field names can originate from attacker-controlled
	// custom field keys via ExternalImport, so guard against formula injection here too)
	sanitizedHeader := make([]string, len(fieldOrder))
	for i, h := range fieldOrder {
		sanitizedHeader[i] = sanitizeCSVField(h)
	}
	if err := writer.Write(sanitizedHeader); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to write CSV header"})
	}

	// Write rows
	for _, attendee := range attendees {
		row := make([]string, len(fieldOrder))
		for i, field := range fieldOrder {
			switch field {
			case "code":
				row[i] = sanitizeCSVField(attendee.Code)
			case "first_name":
				row[i] = sanitizeCSVField(attendee.FirstName)
			case "last_name":
				row[i] = sanitizeCSVField(attendee.LastName)
			case "email":
				row[i] = sanitizeCSVField(attendee.Email)
			case "company":
				row[i] = sanitizeCSVField(attendee.Company)
			case "position":
				row[i] = sanitizeCSVField(attendee.Position)
			case "checkin_status":
				if attendee.CheckinStatus {
					row[i] = "true"
				} else {
					row[i] = "false"
				}
			default:
				// Check custom fields
				if val, ok := attendee.CustomFields[field]; ok {
					row[i] = sanitizeCSVField(fmt.Sprintf("%v", val))
				}
			}
		}
		if err := writer.Write(row); err != nil {
			c.Logger().Errorf("Failed to write CSV row: %v", err)
			continue
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate CSV"})
	}

	// Set headers for download
	filename := fmt.Sprintf("%s-attendees.csv", strings.ReplaceAll(event.Name, " ", "-"))
	c.Response().Header().Set("Content-Type", "text/csv")
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))

	return c.String(http.StatusOK, csvData.String())
}

// Helper function to generate unique code
func generateUniqueCode() string {
	// Generate a short UUID-based code
	id := uuid.New()
	return strings.ToUpper(id.String()[:8])
}
