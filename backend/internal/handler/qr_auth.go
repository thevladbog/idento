package handler

import (
	"idento/backend/internal/models"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
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
	claims := &models.JWTCustomClaims{
		UserID:   user.ID.String(),
		TenantID: user.TenantID.String(),
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	t, err := token.SignedString([]byte("your-secret-key")) // TODO: use env var
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": t,
		"user":  user,
	})
}
