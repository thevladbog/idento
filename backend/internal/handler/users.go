package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"idento/backend/internal/models"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// GetUsers returns all users in the tenant
func (h *Handler) GetUsers(c echo.Context) error {
	user, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid token")
	}

	// Only admin and manager can view users
	if user.Role != "admin" && user.Role != "manager" {
		return echo.NewHTTPError(http.StatusForbidden, "Access denied")
	}

	users, err := h.Store.GetUsersByTenantID(c.Request().Context(), tenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch users")
	}

	for _, u := range users {
		u.HasQRToken = u.QRToken != nil
	}

	return c.JSON(http.StatusOK, users)
}

// CreateUser creates a new user (staff or manager)
func (h *Handler) CreateUser(c echo.Context) error {
	user, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid token")
	}

	// Only admin can create users
	if user.Role != "admin" {
		return echo.NewHTTPError(http.StatusForbidden, "Only admins can create users")
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"` // staff or manager
	}

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	// Validate role
	if req.Role != "staff" && req.Role != "manager" {
		return echo.NewHTTPError(http.StatusBadRequest, "Role must be 'staff' or 'manager'")
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to hash password")
	}

	newUser := &models.User{
		ID:           uuid.New(),
		TenantID:     tenantID,
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
		Role:         req.Role,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := h.Store.CreateUser(c.Request().Context(), newUser); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create user")
	}

	// Add the new user to user_tenants so GetUserTenantRole (used by
	// GenerateQRToken and CreateStationProvisioningToken) can find them.
	userTenant := &models.UserTenant{
		UserID:   newUser.ID,
		TenantID: tenantID,
		Role:     req.Role,
		JoinedAt: time.Now(),
	}
	if err := h.Store.AddUserToTenant(c.Request().Context(), userTenant); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to add user to tenant")
	}

	// Log usage
	if err := h.Store.LogUsage(c.Request().Context(), &models.UsageLog{
		TenantID:     tenantID,
		ResourceType: "user",
		ResourceID:   &newUser.ID,
		Action:       "created",
		Quantity:     1,
	}); err != nil {
		log.Printf("Failed to log usage: %v", err)
	}

	return c.JSON(http.StatusCreated, newUser)
}

// GenerateQRToken generates a QR token for staff quick login
func (h *Handler) GenerateQRToken(c echo.Context) error {
	currentUser, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	// Only admin can generate QR tokens
	if currentUser.Role != "admin" {
		return echo.NewHTTPError(http.StatusForbidden, "Only admins can generate QR tokens")
	}

	userID := c.Param("id")
	userUUID, err := uuid.Parse(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid user ID")
	}

	// Get user
	targetUser, err := h.Store.GetUserByID(c.Request().Context(), userUUID)
	if err != nil || targetUser == nil {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}

	// Verify the target user is a member of the caller's ACTIVE tenant
	// (user_tenants), not their home tenant — users can belong to many orgs.
	currentTenantID, err := uuid.Parse(currentUser.TenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid tenant ID")
	}
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), targetUser.ID, currentTenantID)
	if err != nil || role == "" {
		// Uniform 404: don't reveal that the user exists in another tenant.
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}

	// Generate random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}
	token := fmt.Sprintf("QR_%s_%s", userUUID.String(), hex.EncodeToString(tokenBytes))
	now := time.Now()

	// Update user with QR token
	if err := h.Store.UpdateUserQRToken(c.Request().Context(), userUUID, token, now); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to save QR token")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"qr_token": token,
		"user_id":  userUUID.String(),
		"email":    targetUser.Email,
	})
}

// AssignStaffToEvent assigns a staff user to an event
func (h *Handler) AssignStaffToEvent(c echo.Context) error {
	user, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	tenantID, err := uuid.Parse(user.TenantID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid tenant ID")
	}

	// Only admin and manager can assign staff
	if user.Role != "admin" && user.Role != "manager" {
		return echo.NewHTTPError(http.StatusForbidden, "Access denied")
	}

	eventID := c.Param("event_id")
	eventUUID, err := uuid.Parse(eventID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid event ID")
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	userUUID, err := uuid.Parse(req.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid user ID")
	}

	// Verify event belongs to the active tenant (scoped lookup, 404 on foreign).
	if _, err := h.requireEventOwnership(c, eventUUID); err != nil {
		return writeErr(c, err)
	}

	// Verify the target user is a member of the active tenant.
	targetUser, err := h.Store.GetUserByID(c.Request().Context(), userUUID)
	if err != nil || targetUser == nil {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), targetUser.ID, tenantID)
	if err != nil || role == "" {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}

	// Create assignment
	assignedBy, err := uuid.Parse(user.UserID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid user ID")
	}
	assignment := &models.EventStaff{
		ID:         uuid.New(),
		EventID:    eventUUID,
		UserID:     userUUID,
		AssignedAt: time.Now(),
		AssignedBy: assignedBy,
	}

	if err := h.Store.AssignStaffToEvent(c.Request().Context(), assignment); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to assign staff")
	}

	return c.JSON(http.StatusCreated, assignment)
}

// GetEventStaff returns staff assigned to an event
func (h *Handler) GetEventStaff(c echo.Context) error {
	eventID := c.Param("event_id")
	eventUUID, err := uuid.Parse(eventID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid event ID")
	}

	// Verify event belongs to tenant (scoped lookup, 404 on foreign).
	if _, err := h.requireEventOwnership(c, eventUUID); err != nil {
		return writeErr(c, err)
	}

	staff, err := h.Store.GetEventStaff(c.Request().Context(), eventUUID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch staff")
	}

	return c.JSON(http.StatusOK, staff)
}
