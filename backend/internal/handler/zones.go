package handler

import (
	"encoding/json"
	"idento/backend/internal/models"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/skip2/go-qrcode"
)

// Event Zone Management

// CreateEventZone creates a new zone for an event
func (h *Handler) CreateEventZone(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	var zone models.EventZone
	if err := c.Bind(&zone); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	zone.EventID = eventID

	if err := h.Store.CreateEventZone(c.Request().Context(), &zone); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create zone"})
	}

	return c.JSON(http.StatusCreated, zone)
}

// GetEventZones retrieves all zones for an event
func (h *Handler) GetEventZones(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	withStats := c.QueryParam("with_stats") == "true"

	if withStats {
		zones, err := h.Store.GetEventZonesWithStats(c.Request().Context(), eventID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get zones"})
		}
		return c.JSON(http.StatusOK, zones)
	}

	zones, err := h.Store.GetEventZones(c.Request().Context(), eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get zones"})
	}

	return c.JSON(http.StatusOK, zones)
}

// GetEventZone retrieves a single zone by ID
func (h *Handler) GetEventZone(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	zone, err := h.Store.GetEventZoneByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
	}

	return c.JSON(http.StatusOK, zone)
}

// UpdateEventZone updates a zone
func (h *Handler) UpdateEventZone(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	var zone models.EventZone
	if err := c.Bind(&zone); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	zone.ID = id

	if err := h.Store.UpdateEventZone(c.Request().Context(), &zone); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update zone"})
	}

	return c.JSON(http.StatusOK, zone)
}

// DeleteEventZone deletes a zone
func (h *Handler) DeleteEventZone(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	if err := h.Store.DeleteEventZone(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete zone"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Zone deleted successfully"})
}

// Zone Access Rules

// CreateZoneAccessRule creates a new access rule
func (h *Handler) CreateZoneAccessRule(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	var rule models.ZoneAccessRule
	if err := c.Bind(&rule); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	rule.ZoneID = zoneID

	if err := h.Store.CreateZoneAccessRule(c.Request().Context(), &rule); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create access rule"})
	}

	return c.JSON(http.StatusCreated, rule)
}

// GetZoneAccessRules retrieves all access rules for a zone
func (h *Handler) GetZoneAccessRules(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	rules, err := h.Store.GetZoneAccessRules(c.Request().Context(), zoneID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get access rules"})
	}

	return c.JSON(http.StatusOK, rules)
}

// BulkUpdateZoneAccessRules updates all access rules for a zone
func (h *Handler) BulkUpdateZoneAccessRules(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	var rules []*models.ZoneAccessRule
	if err := c.Bind(&rules); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	if err := h.Store.BulkUpdateZoneAccessRules(c.Request().Context(), zoneID, rules); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update access rules"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Access rules updated successfully"})
}

// Individual Attendee Access

// CreateAttendeeZoneAccess creates an individual access override
func (h *Handler) CreateAttendeeZoneAccess(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("attendee_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	var access models.AttendeeZoneAccess
	if err := c.Bind(&access); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	access.AttendeeID = attendeeID

	if err := h.Store.CreateAttendeeZoneAccess(c.Request().Context(), &access); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create access override"})
	}

	return c.JSON(http.StatusCreated, access)
}

// GetAttendeeZoneAccess retrieves all access overrides for an attendee
func (h *Handler) GetAttendeeZoneAccess(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("attendee_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	accesses, err := h.Store.GetAttendeeZoneAccessList(c.Request().Context(), attendeeID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get access overrides"})
	}

	return c.JSON(http.StatusOK, accesses)
}

// UpdateAttendeeZoneAccess updates an access override
func (h *Handler) UpdateAttendeeZoneAccess(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid ID"})
	}

	var access models.AttendeeZoneAccess
	if err := c.Bind(&access); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	access.ID = id

	if err := h.Store.UpdateAttendeeZoneAccess(c.Request().Context(), &access); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update access override"})
	}

	return c.JSON(http.StatusOK, access)
}

// DeleteAttendeeZoneAccess deletes an access override
func (h *Handler) DeleteAttendeeZoneAccess(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid ID"})
	}

	if err := h.Store.DeleteAttendeeZoneAccess(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete access override"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Access override deleted successfully"})
}

// Staff Zone Assignments

// AssignStaffToZone assigns a staff member to a zone
func (h *Handler) AssignStaffToZone(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	var req struct {
		UserID uuid.UUID `json:"user_id"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	assignedByID := uuid.MustParse(claims.UserID)

	assignment := &models.StaffZoneAssignment{
		UserID:     req.UserID,
		ZoneID:     zoneID,
		AssignedBy: &assignedByID,
	}

	if err := h.Store.AssignStaffToZone(c.Request().Context(), assignment); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to assign staff"})
	}

	return c.JSON(http.StatusCreated, assignment)
}

// GetZoneStaff retrieves all staff assigned to a zone
func (h *Handler) GetZoneStaff(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	assignments, err := h.Store.GetZoneStaffAssignments(c.Request().Context(), zoneID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get staff assignments"})
	}

	return c.JSON(http.StatusOK, assignments)
}

// RemoveStaffFromZone removes a staff member from a zone
func (h *Handler) RemoveStaffFromZone(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	userID, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	if err := h.Store.RemoveStaffFromZone(c.Request().Context(), userID, zoneID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to remove staff"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Staff removed successfully"})
}

// GetUserZoneAssignments retrieves all zone assignments for a user
func (h *Handler) GetUserZoneAssignments(c echo.Context) error {
	userID, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	assignments, err := h.Store.GetStaffZoneAssignments(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get zone assignments"})
	}

	return c.JSON(http.StatusOK, assignments)
}

// Zone Check-in

// ZoneCheckIn performs a check-in for a zone
func (h *Handler) ZoneCheckIn(c echo.Context) error {
	var req models.ZoneCheckInRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Invalid request",
		})
	}

	ctx := c.Request().Context()

	// 1. Find attendee by code
	// First, we need to get the event_id from the zone
	zone, err := h.Store.GetEventZoneByID(ctx, req.ZoneID)
	if err != nil || zone == nil {
		return c.JSON(http.StatusNotFound, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Zone not found",
		})
	}

	attendee, err := h.Store.GetAttendeeByCode(ctx, zone.EventID, req.AttendeeCode)
	if err != nil || attendee == nil {
		return c.JSON(http.StatusNotFound, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Attendee not found",
		})
	}

	// 2. Validate zone is active
	if !zone.IsActive {
		return c.JSON(http.StatusForbidden, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Zone is not active",
		})
	}

	// 3. Check time constraints
	if !isWithinZoneTime(zone, time.Now()) {
		return c.JSON(http.StatusForbidden, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Zone is closed at this time",
		})
	}

	// 4. For registration zones, perform registration
	if zone.IsRegistrationZone {
		now := time.Now()
		attendee.RegisteredAt = &now
		attendee.RegistrationZoneID = &zone.ID
		attendee.PacketDelivered = true // Auto-deliver packet
		if err := h.Store.UpdateAttendee(ctx, attendee); err != nil {
			return c.JSON(http.StatusInternalServerError, models.ZoneCheckInResponse{
				Success: false,
				Error:   "Failed to register attendee",
			})
		}
	} else {
		// 5. For non-registration zones, check if already registered
		if zone.RequiresRegistration && attendee.RegisteredAt == nil {
			return c.JSON(http.StatusForbidden, models.ZoneCheckInResponse{
				Success: false,
				Error:   "Attendee must register first",
			})
		}
	}

	// 6. Check access permissions (category + individual overrides)
	allowed, reason, err := h.Store.CheckZoneAccess(ctx, attendee.ID, zone.ID)
	if err != nil || !allowed {
		return c.JSON(http.StatusForbidden, models.ZoneCheckInResponse{
			Success: false,
			Error:   reason,
		})
	}

	// 7. Check if already checked in today
	existing, err := h.Store.CheckAttendeeZoneCheckin(ctx, attendee.ID, zone.ID, req.EventDay)
	if err != nil {
		log.Printf("Failed to check existing zone checkin: %v", err)
		return c.JSON(http.StatusInternalServerError, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Failed to verify check-in status",
		})
	}
	if existing != nil {
		return c.JSON(http.StatusOK, models.ZoneCheckInResponse{
			Success:         true,
			Attendee:        attendee,
			Zone:            zone,
			CheckedInAt:     existing.CheckedInAt,
			PacketDelivered: attendee.PacketDelivered,
			Message:         "Already checked in",
		})
	}

	// 8. Create zone check-in record
	claims := c.Get("user").(*models.JWTCustomClaims)
	checkinByID := uuid.MustParse(claims.UserID)

	checkin := &models.ZoneCheckin{
		AttendeeID:  attendee.ID,
		ZoneID:      zone.ID,
		CheckedInBy: &checkinByID,
		EventDay:    req.EventDay,
	}

	if err := h.Store.CreateZoneCheckin(ctx, checkin); err != nil {
		return c.JSON(http.StatusInternalServerError, models.ZoneCheckInResponse{
			Success: false,
			Error:   "Failed to create check-in",
		})
	}

	// 9. Log usage
	event, err := h.Store.GetEventByID(ctx, zone.EventID)
	if err != nil {
		log.Printf("Failed to get event for logging: %v", err)
	}
	if event != nil {
		if err := h.Store.LogUsage(ctx, &models.UsageLog{
			TenantID:     event.TenantID,
			ResourceType: "zone_checkin",
			ResourceID:   &checkin.ID,
			Action:       "created",
			Quantity:     1,
		}); err != nil {
			log.Printf("Failed to log usage: %v", err)
		}
	}

	return c.JSON(http.StatusOK, models.ZoneCheckInResponse{
		Success:         true,
		Attendee:        attendee,
		Zone:            zone,
		CheckedInAt:     checkin.CheckedInAt,
		PacketDelivered: attendee.PacketDelivered,
		Message:         "Check-in successful",
	})
}

// GetZoneCheckins retrieves check-ins for a zone on a specific date
func (h *Handler) GetZoneCheckins(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	dateStr := c.QueryParam("date")
	var date time.Time
	if dateStr != "" {
		date, err = time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid date format"})
		}
	} else {
		date = time.Now()
	}

	checkins, err := h.Store.GetZoneCheckins(c.Request().Context(), zoneID, date)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get check-ins"})
	}

	return c.JSON(http.StatusOK, checkins)
}

// GetAttendeeZoneHistory retrieves movement history for an attendee
func (h *Handler) GetAttendeeZoneHistory(c echo.Context) error {
	attendeeID, err := uuid.Parse(c.Param("attendee_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid attendee ID"})
	}

	ctx := c.Request().Context()

	// Get all zone check-ins for this attendee
	checkins, err := h.Store.GetAttendeeZoneCheckins(ctx, attendeeID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get history"})
	}

	// Enrich with zone details
	var history []models.MovementHistoryEntry
	for _, checkin := range checkins {
		zone, err := h.Store.GetEventZoneByID(ctx, checkin.ZoneID)
		if err != nil {
			log.Printf("Failed to get zone details: %v", err)
		}

		entry := models.MovementHistoryEntry{
			ZoneCheckin: checkin,
		}

		if zone != nil {
			entry.ZoneName = zone.Name
			entry.ZoneType = zone.ZoneType
		}

		history = append(history, entry)
	}

	return c.JSON(http.StatusOK, history)
}

// Mobile API - filtered by staff permissions

// GetAvailableZones retrieves zones available to the current user
func (h *Handler) GetAvailableZones(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	userID := uuid.MustParse(claims.UserID)

	ctx := c.Request().Context()

	// Get all zones for the event
	allZones, err := h.Store.GetEventZones(ctx, eventID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get zones"})
	}

	// If admin/manager, return all zones
	if claims.Role == "admin" || claims.Role == "manager" {
		return c.JSON(http.StatusOK, allZones)
	}

	// For staff, filter by assignments
	assignments, err := h.Store.GetStaffZoneAssignments(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get assignments"})
	}

	// Create a map of assigned zone IDs
	assignedZoneIDs := make(map[uuid.UUID]bool)
	for _, assignment := range assignments {
		assignedZoneIDs[assignment.ZoneID] = true
	}

	// Filter zones
	var availableZones []*models.EventZone
	for _, zone := range allZones {
		if assignedZoneIDs[zone.ID] {
			availableZones = append(availableZones, zone)
		}
	}

	return c.JSON(http.StatusOK, availableZones)
}

// GetZoneDays retrieves available days for a zone (based on event date range)
func (h *Handler) GetZoneDays(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	ctx := c.Request().Context()

	zone, err := h.Store.GetEventZoneByID(ctx, zoneID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
	}

	event, err := h.Store.GetEventByID(ctx, zone.EventID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Event not found"})
	}

	// Generate days from start_date to end_date
	var days []map[string]interface{}
	if event.StartDate != nil && event.EndDate != nil {
		currentDay := event.StartDate.Truncate(24 * time.Hour)
		endDay := event.EndDate.Truncate(24 * time.Hour)

		dayNumber := 1
		for !currentDay.After(endDay) {
			days = append(days, map[string]interface{}{
				"date":       currentDay.Format("2006-01-02"),
				"day_number": dayNumber,
				"is_today":   currentDay.Format("2006-01-02") == time.Now().Format("2006-01-02"),
				"is_past":    currentDay.Before(time.Now().Truncate(24 * time.Hour)),
				"is_future":  currentDay.After(time.Now().Truncate(24 * time.Hour)),
			})
			currentDay = currentDay.Add(24 * time.Hour)
			dayNumber++
		}
	}

	return c.JSON(http.StatusOK, days)
}

// QR Code Generation for Zones

// GetZoneQRCode generates a QR code for zone selection
func (h *Handler) GetZoneQRCode(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}

	zone, err := h.Store.GetEventZoneByID(c.Request().Context(), zoneID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Zone not found"})
	}

	qrData := models.ZoneQRData{
		ZoneID:   zone.ID.String(),
		EventID:  zone.EventID.String(),
		ZoneName: zone.Name,
		Type:     "zone_select",
	}

	jsonData, err := json.Marshal(qrData)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate QR data"})
	}

	// Generate QR code PNG
	qrCode, err := qrcode.Encode(string(jsonData), qrcode.Medium, 256)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate QR code"})
	}

	return c.Blob(http.StatusOK, "image/png", qrCode)
}

// Helper function

// isWithinZoneTime checks if the current time is within the zone's time constraints
func isWithinZoneTime(zone *models.EventZone, now time.Time) bool {
	if zone.OpenTime == nil && zone.CloseTime == nil {
		return true // No time constraints
	}

	currentTime := now.Format("15:04")

	if zone.OpenTime != nil && currentTime < *zone.OpenTime {
		return false
	}

	if zone.CloseTime != nil && currentTime > *zone.CloseTime {
		return false
	}

	return true
}
