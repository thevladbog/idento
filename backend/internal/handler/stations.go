package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// CreateStationProvisioningToken lets a manager/admin mint a short-lived (10
// minute), one-time token — shown as a QR in the web console — that binds a new
// mobile station to a specific existing staff user for this event.
func (h *Handler) CreateStationProvisioningToken(c echo.Context) error {
	eventID, err := uuid.Parse(c.Param("event_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid event ID"})
	}
	if _, err := h.requireEventOwnership(c, eventID); err != nil {
		return writeErr(c, err)
	}

	claims := c.Get("user").(*models.JWTCustomClaims)
	if claims.Role != "admin" && claims.Role != "manager" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Only admins/managers can provision stations"})
	}
	callerID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}
	tenantID, err := uuid.Parse(claims.TenantID)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid token"})
	}

	var req models.CreateProvisioningTokenRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	staffUser, err := h.Store.GetUserByID(c.Request().Context(), req.StaffUserID)
	if err != nil || staffUser == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Staff user not found"})
	}
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), staffUser.ID, tenantID)
	if err != nil || role == "" {
		// Uniform 404: don't reveal that the user exists in another tenant.
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Staff user not found"})
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}
	tok := &models.StationProvisioningToken{
		Token:       hex.EncodeToString(tokenBytes),
		EventID:     eventID,
		StaffUserID: staffUser.ID,
		CreatedBy:   callerID,
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	}
	if err := h.Store.CreateProvisioningToken(c.Request().Context(), tok); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create provisioning token"})
	}

	return c.JSON(http.StatusCreated, models.CreateProvisioningTokenResponse{
		Token:     tok.Token,
		ExpiresAt: tok.ExpiresAt,
	})
}

// ProvisionStation redeems a one-time provisioning token — PUBLIC, unauthenticated,
// since the mobile device has no JWT yet — and mints one for the token's bound
// staff user, plus a per-event device number.
func (h *Handler) ProvisionStation(c echo.Context) error {
	var req models.ProvisionStationRequest
	if err := c.Bind(&req); err != nil || req.Token == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	tok, err := h.Store.ConsumeProvisioningToken(c.Request().Context(), req.Token)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to redeem token"})
	}
	if tok == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
	}

	event, err := h.Store.GetEventByID(c.Request().Context(), tok.EventID)
	if err != nil || event == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load event"})
	}
	staffUser, err := h.Store.GetUserByID(c.Request().Context(), tok.StaffUserID)
	if err != nil || staffUser == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load staff user"})
	}

	station, err := h.Store.CreateStation(c.Request().Context(), tok.EventID, tok.StaffUserID, req.DeviceInfo)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create station"})
	}

	jwtToken, err := generateTokenForTenant(staffUser, event.TenantID.String(), staffUser.Role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue token"})
	}

	return c.JSON(http.StatusOK, models.ProvisionStationResponse{
		StationConfig: models.ProvisionedStationConfig{
			EventID:   event.ID,
			EventName: event.Name,
			StaffName: staffUser.Email,
		},
		StaffJWT:     jwtToken,
		DeviceNumber: station.DeviceNumber,
	})
}
