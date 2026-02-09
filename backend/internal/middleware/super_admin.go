package middleware

import (
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// SuperAdminOnly returns Echo middleware that allows only users with IsSuperAdmin set in the store.
func SuperAdminOnly(s store.Store) echo.MiddlewareFunc {
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

			userID, err := uuid.Parse(claims.UserID)
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error": "Invalid user ID",
				})
			}

			// Проверяем флаг super_admin из базы
			dbUser, userErr := s.GetUserByID(c.Request().Context(), userID)
			if userErr != nil || dbUser == nil || !dbUser.IsSuperAdmin {
				return c.JSON(http.StatusForbidden, map[string]string{
					"error": "Super admin access required",
				})
			}

			return next(c)
		}
	}
}
