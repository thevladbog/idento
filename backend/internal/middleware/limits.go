package middleware

import (
	"fmt"
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CheckLimits returns Echo middleware that enforces tenant limits before creating resources (e.g. users, events, attendees).
func CheckLimits(s store.Store, resourceType string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			user := c.Get("user")
			if user == nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "Unauthorized",
				})
			}
			claims, ok := user.(*models.JWTCustomClaims)
			if !ok {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "Invalid token claims",
				})
			}

			tenantID, err := uuid.Parse(claims.TenantID)
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error": "Invalid tenant ID",
				})
			}

			allowed, current, max, err := s.CheckTenantLimit(
				c.Request().Context(),
				tenantID,
				resourceType,
			)

			if err != nil || !allowed {
				return c.JSON(http.StatusForbidden, map[string]interface{}{
					"error":            fmt.Sprintf("Limit exceeded for %s", resourceType),
					"current":          current,
					"max":              max,
					"upgrade_required": true,
					"limit_type":       resourceType,
				})
			}

			return next(c)
		}
	}
}

// CheckAttendeeLimits enforces attendees_per_event for the event in the
// route (:event_id). Single-create path only — bulk import validates its
// batch size in the handler where the count is known.
func CheckAttendeeLimits(s store.Store) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get("user").(*models.JWTCustomClaims)
			if !ok {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			}
			tenantID, err := uuid.Parse(claims.TenantID)
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
			}
			eventID, err := uuid.Parse(c.Param("event_id"))
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
			}
			allowed, current, max, err := s.CheckAttendeeLimit(c.Request().Context(), tenantID, eventID, 1)
			if err != nil {
				// Store failure is not a limit violation — surface it honestly.
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check attendee limit"})
			}
			if !allowed {
				return c.JSON(http.StatusForbidden, map[string]interface{}{
					"error":            "Limit exceeded for attendees_per_event",
					"current":          current,
					"max":              max,
					"upgrade_required": true,
					"limit_type":       "attendees_per_event",
				})
			}
			return next(c)
		}
	}
}
