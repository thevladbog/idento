package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"idento/backend/internal/models"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// GetUsers returns all users in the tenant
func (h *Handler) GetUsers(c echo.Context) error {
	user := c.Get("user").(*models.JWTCustomClaims)
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

	return c.JSON(http.StatusOK, users)
}

// CreateUser creates a new user (staff or manager)
func (h *Handler) CreateUser(c echo.Context) error {
	user := c.Get("user").(*models.JWTCustomClaims)
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

	// Log usage
	_ = h.Store.LogUsage(c.Request().Context(), &models.UsageLog{
		TenantID:     tenantID,
		ResourceType: "user",
		ResourceID:   &newUser.ID,
		Action:       "created",
		Quantity:     1,
	})

	return c.JSON(http.StatusCreated, newUser)
}

// GenerateQRToken generates a QR token for staff quick login
func (h *Handler) GenerateQRToken(c echo.Context) error {
	currentUser := c.Get("user").(*models.JWTCustomClaims)

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

	// Verify same tenant
	currentTenantID, _ := uuid.Parse(currentUser.TenantID)
	if targetUser.TenantID != currentTenantID {
		return echo.NewHTTPError(http.StatusForbidden, "Access denied")
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
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, _ := uuid.Parse(user.TenantID)

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

	// Verify event belongs to tenant
	event, err := h.Store.GetEventByID(c.Request().Context(), eventUUID)
	if err != nil || event == nil || event.TenantID != tenantID {
		return echo.NewHTTPError(http.StatusNotFound, "Event not found")
	}

	// Verify user belongs to tenant
	targetUser, err := h.Store.GetUserByID(c.Request().Context(), userUUID)
	if err != nil || targetUser == nil || targetUser.TenantID != tenantID {
		return echo.NewHTTPError(http.StatusNotFound, "User not found")
	}

	// Create assignment
	assignedBy, _ := uuid.Parse(user.UserID)
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
	user := c.Get("user").(*models.JWTCustomClaims)
	tenantID, _ := uuid.Parse(user.TenantID)

	eventID := c.Param("event_id")
	eventUUID, err := uuid.Parse(eventID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid event ID")
	}

	// Verify event belongs to tenant
	event, err := h.Store.GetEventByID(c.Request().Context(), eventUUID)
	if err != nil || event == nil || event.TenantID != tenantID {
		return echo.NewHTTPError(http.StatusNotFound, "Event not found")
	}

	staff, err := h.Store.GetEventStaff(c.Request().Context(), eventUUID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch staff")
	}

	return c.JSON(http.StatusOK, staff)
}
