package handler

import (
	"net/http"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// ZoneScan computes a mobile zone-control verdict (allowed | no_access |
// not_registered) for a scanned attendee code. Unlike the legacy
// POST /api/zones/checkin, this always returns HTTP 200 with a structured
// verdict — all three outcomes are valid business results the mobile UI
// renders as distinct screens, not error states. On an "allowed" verdict it
// records a zone_checkins row exactly like the legacy handler (same
// idempotency check), and logs every outcome to zone_scan_log for stats.
func (h *Handler) ZoneScan(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("zone_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid zone ID"})
	}
	zone, event, err := h.requireZoneOwnership(c, zoneID)
	if err != nil {
		return writeErr(c, err)
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	callerID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}
	if claims.Role != "admin" && claims.Role != "manager" {
		assignments, err := h.Store.GetZoneStaffAssignments(c.Request().Context(), zoneID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify zone assignment"})
		}
		assigned := false
		for _, a := range assignments {
			if a.UserID == callerID {
				assigned = true
				break
			}
		}
		if !assigned {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "Not assigned to this zone"})
		}
	}

	var req models.ZoneScanRequest
	if err := c.Bind(&req); err != nil || req.Code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	attendee, err := h.Store.GetAttendeeByCode(c.Request().Context(), event.ID, req.Code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to look up attendee"})
	}
	if attendee == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Attendee not found"})
	}

	now := time.Now()
	regInfo := &models.RegistrationInfo{Passed: attendee.RegisteredAt != nil, At: attendee.RegisteredAt}
	if attendee.RegistrationZoneID != nil {
		if regZone, err := h.Store.GetEventZoneByID(c.Request().Context(), *attendee.RegistrationZoneID); err == nil && regZone != nil {
			regInfo.Point = regZone.Name
		}
	}

	if !zone.IsActive || !isWithinZoneTime(zone, now) {
		_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "no_access")
		return c.JSON(http.StatusOK, models.ZoneScanResponse{
			Verdict:      "no_access",
			Reason:       "Zone is closed",
			Attendee:     attendee,
			Registration: regInfo,
		})
	}

	if zone.RequiresRegistration && attendee.RegisteredAt == nil {
		_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "not_registered")
		return c.JSON(http.StatusOK, models.ZoneScanResponse{
			Verdict:      "not_registered",
			Reason:       "Attendee has not registered yet",
			Attendee:     attendee,
			Registration: regInfo,
		})
	}

	allowed, reason, err := h.Store.CheckZoneAccessAt(c.Request().Context(), attendee.ID, zoneID, now)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to evaluate zone access"})
	}
	if !allowed {
		_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "no_access")
		return c.JSON(http.StatusOK, models.ZoneScanResponse{
			Verdict:      "no_access",
			Reason:       reason,
			Attendee:     attendee,
			Registration: regInfo,
		})
	}

	existing, err := h.Store.CheckAttendeeZoneCheckin(c.Request().Context(), attendee.ID, zoneID, now)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check idempotency"})
	}
	firstEntry := existing == nil
	if firstEntry {
		if err := h.Store.CreateZoneCheckin(c.Request().Context(), &models.ZoneCheckin{
			AttendeeID:  attendee.ID,
			ZoneID:      zoneID,
			CheckedInBy: &callerID,
			EventDay:    now,
			Metadata:    map[string]interface{}{"source": "mobile_scan"},
		}); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to record zone entry"})
		}
	}
	_ = h.Store.CreateZoneScanLog(c.Request().Context(), zoneID, &attendee.ID, "allowed")

	return c.JSON(http.StatusOK, models.ZoneScanResponse{
		Verdict:      "allowed",
		Reason:       reason,
		Attendee:     attendee,
		Registration: regInfo,
		CheckedInAt:  &now,
		FirstEntry:   firstEntry,
	})
}
