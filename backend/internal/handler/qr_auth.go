package handler

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// LoginWithQR allows staff to login using QR token
func (h *Handler) LoginWithQR(c echo.Context) error {
	var req struct {
		QRToken string `json:"qr_token"`
	}

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	// Find user by QR token
	user, err := h.Store.GetUserByQRToken(c.Request().Context(), req.QRToken)
	if err != nil || user == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid QR token")
	}

	// Check if token is not too old (optional: 30 days validity)
	if user.QRTokenCreatedAt != nil {
		if time.Since(*user.QRTokenCreatedAt) > 30*24*time.Hour {
			return echo.NewHTTPError(http.StatusUnauthorized, "QR token expired")
		}
	}

	// Generate JWT
	tokenString, err := generateTokenForTenant(user, user.TenantID.String(), user.Role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue token"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": tokenString,
		"user":  user,
	})
}
