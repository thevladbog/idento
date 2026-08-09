package handler

import (
	"net/http"
	"time"

	"github.com/google/uuid"
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

	// Scoped credentials are always persisted with their creation time. A
	// missing timestamp is an incomplete credential, not an unlimited token.
	if user.QRTokenCreatedAt == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid QR token")
	}
	if time.Since(*user.QRTokenCreatedAt) > 30*24*time.Hour {
		return echo.NewHTTPError(http.StatusUnauthorized, "QR token expired")
	}

	// Legacy credentials had no tenant scope. A scoped credential is also
	// invalid as soon as its tenant membership disappears or changes role.
	if user.QRTokenTenantID == nil || *user.QRTokenTenantID == uuid.Nil || user.QRTokenRole == nil || !isQRLoginRole(*user.QRTokenRole) {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid QR token")
	}
	liveRole, err := h.Store.GetUserTenantRole(c.Request().Context(), user.ID, *user.QRTokenTenantID)
	if err != nil || liveRole != *user.QRTokenRole {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid QR token")
	}

	// Generate a JWT and response for the credential's active scope, never the
	// user's home tenant/role stored on the users row.
	scopedUser := *user
	scopedUser.TenantID = *user.QRTokenTenantID
	scopedUser.Role = *user.QRTokenRole
	tokenString, err := generateTokenForTenant(&scopedUser, scopedUser.TenantID.String(), scopedUser.Role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue token"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": tokenString,
		"user":  &scopedUser,
	})
}

func isQRLoginRole(role string) bool {
	return role == "admin" || role == "manager" || role == "staff"
}
