package handler

import (
	"errors"
	"fmt"
	"idento/backend/internal/config"
	"idento/backend/internal/models"
	"idento/backend/internal/store"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// RegisterRequest is the JSON body for POST /auth/register.
type RegisterRequest struct {
	TenantName string `json:"tenant_name"`
	Email      string `json:"email"`
	Password   string `json:"password"`
}

// LoginRequest is the JSON body for POST /auth/login.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse is the JSON response for register and login (token and user).
type AuthResponse struct {
	Token string       `json:"token"`
	User  *models.User `json:"user"`
}

// Register creates a tenant and an admin user, or adds an existing user to the new tenant.
// Returns 400 on invalid input, 500 on store or token errors.
func (h *Handler) Register(c echo.Context) error {
	req := new(RegisterRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.TenantName = strings.TrimSpace(req.TenantName)
	if req.Email == "" || req.TenantName == "" || len(req.Password) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// One transaction: tenant + subscription + user + membership (P1.10).
	// The store hashes/verifies the password itself: attaching a new org to
	// an EXISTING email requires the correct password (SEC — otherwise any
	// caller knowing an email could mint a token for that account).
	tenant, existingUser, err := h.Store.ProvisionTenantWithAdmin(
		c.Request().Context(), req.TenantName, req.Email, req.Password)
	if err != nil {
		if errors.Is(err, store.ErrInvalidCredentials) {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create tenant"})
	}

	// 4. Generate Token with this tenant
	token, err := generateTokenForTenant(existingUser, tenant.ID.String(), "admin")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	// 5. Get all user's tenants for response
	tenants, err := h.Store.GetUserTenants(c.Request().Context(), existingUser.ID)
	if err != nil {
		// Log error but continue with empty list
		log.Printf("Failed to get user tenants: %v", err)
		tenants = []*models.Tenant{}
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"token":   token,
		"user":    existingUser,
		"tenants": tenants,
	})
}

// Login authenticates a user by email and password and returns a JWT and user info.
// Returns 400 on invalid input, 401 on wrong credentials or no tenants, 500 on store or token errors.
func (h *Handler) Login(c echo.Context) error {
	req := new(LoginRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || len(req.Password) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// 1. Find User
	user, err := h.Store.GetUserByEmail(c.Request().Context(), req.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Database error"})
	}
	if user == nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	// 2. Check Password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	// 3. Get all user's tenants
	tenants, err := h.Store.GetUserTenants(c.Request().Context(), user.ID)
	if err != nil || len(tenants) == 0 {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "No organizations found"})
	}

	// 4. Use first tenant as default (or the original tenant_id if available)
	defaultTenant := tenants[0]
	if user.TenantID != uuid.Nil {
		// Check if user's original tenant is in the list
		for _, t := range tenants {
			if t.ID == user.TenantID {
				defaultTenant = t
				break
			}
		}
	}

	// 5. Get role in this tenant
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), user.ID, defaultTenant.ID)
	if err != nil {
		role = "member" // fallback
	}

	// 6. Generate Token with default tenant
	token, err := generateTokenForTenant(user, defaultTenant.ID.String(), role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":          token,
		"user":           user,
		"tenants":        tenants,
		"current_tenant": defaultTenant,
	})
}

func (h *Handler) GetMe(c echo.Context) error {
	// This will rely on middleware setting the user in context
	user := c.Get("user").(*models.JWTCustomClaims)
	return c.JSON(http.StatusOK, map[string]string{
		"user_id":   user.UserID,
		"tenant_id": user.TenantID,
		"role":      user.Role,
	})
}

func generateTokenForTenant(user *models.User, tenantID string, role string) (string, error) {
	claims := &models.JWTCustomClaims{
		UserID:   user.ID.String(),
		TenantID: tenantID,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * 72)), // 3 days
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	secret := config.JWTSecret()
	if secret == "" {
		return "", fmt.Errorf("JWT_SECRET environment variable not set")
	}

	return token.SignedString([]byte(secret))
}

// generateImpersonationToken mints a short-lived token that acts inside the
// target tenant with admin role but attributes every action to the operator:
// UserID and ImpersonatedBy are both the super admin's id.
func generateImpersonationToken(superAdminID, tenantID string) (string, time.Time, error) {
	expiresAt := time.Now().Add(30 * time.Minute)
	claims := &models.JWTCustomClaims{
		UserID:         superAdminID,
		TenantID:       tenantID,
		Role:           "admin",
		ImpersonatedBy: superAdminID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	secret := config.JWTSecret()
	if secret == "" {
		return "", time.Time{}, fmt.Errorf("JWT_SECRET environment variable not set")
	}
	signed, err := token.SignedString([]byte(secret))
	return signed, expiresAt, err
}

type SwitchTenantRequest struct {
	TenantID string `json:"tenant_id"`
}

func (h *Handler) SwitchTenant(c echo.Context) error {
	// Get user from JWT token (set by middleware)
	userClaims := c.Get("user").(*models.JWTCustomClaims)
	userID, err := uuid.Parse(userClaims.UserID)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	req := new(SwitchTenantRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	tenantID, err := uuid.Parse(req.TenantID)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}

	// 1. Check if user belongs to this tenant
	role, err := h.Store.GetUserTenantRole(c.Request().Context(), userID, tenantID)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "You don't have access to this organization"})
	}

	// 2. Get user details
	user, err := h.Store.GetUserByID(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get user"})
	}

	// 3. Get tenant details
	tenant, err := h.Store.GetTenantByID(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get tenant"})
	}

	// 4. Generate new token with new tenant
	token, err := generateTokenForTenant(user, req.TenantID, role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":          token,
		"current_tenant": tenant,
	})
}
