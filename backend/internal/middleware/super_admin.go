package middleware

import (
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func SuperAdminOnly(s store.Store) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims := c.Get("user").(*models.JWTCustomClaims)

			userID, err := uuid.Parse(claims.UserID)
			if err != nil {
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error": "Invalid user ID",
				})
			}

			// Проверяем флаг super_admin из базы
			user, err := s.GetUserByID(c.Request().Context(), userID)
			if err != nil || user == nil || !user.IsSuperAdmin {
				return c.JSON(http.StatusForbidden, map[string]string{
					"error": "Super admin access required",
				})
			}

			return next(c)
		}
	}
}
