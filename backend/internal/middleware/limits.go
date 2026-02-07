package middleware

import (
	"fmt"
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CheckLimits middleware для проверки лимитов перед созданием ресурсов
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
