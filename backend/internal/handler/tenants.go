package handler

import (
	"idento/backend/internal/models"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// GetUserTenants returns all organizations/tenants the current user belongs to
func (h *Handler) GetUserTenants(c echo.Context) error {
	userClaims := c.Get("user").(*models.JWTCustomClaims)
	userID, err := uuid.Parse(userClaims.UserID)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	tenants, err := h.Store.GetUserTenants(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to get tenants"})
	}

	// Add role information for each tenant
	tenantsWithRoles := make([]map[string]interface{}, 0, len(tenants))
	for _, tenant := range tenants {
		role, err := h.Store.GetUserTenantRole(c.Request().Context(), userID, tenant.ID)
		if err != nil {
			// Log the error but default to viewer role to avoid failing the entire request
			// This is more lenient than GetTenant which returns 403, as we're listing
			// all tenants the user belongs to and want to show them with minimal permissions
			log.Printf("Warning: Failed to get role for user %s in tenant %s: %v. Defaulting to viewer", userID, tenant.ID, err)
			role = "viewer"
		}
		tenantsWithRoles = append(tenantsWithRoles, map[string]interface{}{
			"id":            tenant.ID,
			"name":          tenant.Name,
			"settings":      tenant.Settings,
			"logo_url":      tenant.LogoURL,
			"website":       tenant.Website,
			"contact_email": tenant.ContactEmail,
			"created_at":    tenant.CreatedAt,
			"updated_at":    tenant.UpdatedAt,
			"role":          role,
		})
	}

	return c.JSON(http.StatusOK, tenantsWithRoles)
}

// GetTenant returns a specific tenant/organization by ID
func (h *Handler) GetTenant(c echo.Context) error {
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}

	// Verify user has access to this tenant
	userClaims := c.Get("user").(*models.JWTCustomClaims)
	userID, err := uuid.Parse(userClaims.UserID)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	role, err := h.Store.GetUserTenantRole(c.Request().Context(), userID, tenantID)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Access denied"})
	}

	tenant, err := h.Store.GetTenantByID(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":            tenant.ID,
		"name":          tenant.Name,
		"settings":      tenant.Settings,
		"logo_url":      tenant.LogoURL,
		"website":       tenant.Website,
		"contact_email": tenant.ContactEmail,
		"created_at":    tenant.CreatedAt,
		"updated_at":    tenant.UpdatedAt,
		"role":          role,
	})
}

// UpdateTenant updates tenant/organization information
func (h *Handler) UpdateTenant(c echo.Context) error {
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}

	// Verify user has admin access to this tenant
	userClaims := c.Get("user").(*models.JWTCustomClaims)
	userID, err := uuid.Parse(userClaims.UserID)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
	}

	role, err := h.Store.GetUserTenantRole(c.Request().Context(), userID, tenantID)
	if err != nil || role != "admin" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "Admin access required"})
	}

	// Get existing tenant
	tenant, err := h.Store.GetTenantByID(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}

	// Bind updates
	type UpdateRequest struct {
		Name         *string                 `json:"name"`
		Settings     *map[string]interface{} `json:"settings"`
		LogoURL      *string                 `json:"logo_url"`
		Website      *string                 `json:"website"`
		ContactEmail *string                 `json:"contact_email"`
	}

	req := new(UpdateRequest)
	if err := c.Bind(req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Update fields if provided
	if req.Name != nil {
		tenant.Name = *req.Name
	}
	if req.Settings != nil {
		tenant.Settings = *req.Settings
	}
	if req.LogoURL != nil {
		tenant.LogoURL = req.LogoURL
	}
	if req.Website != nil {
		tenant.Website = req.Website
	}
	if req.ContactEmail != nil {
		tenant.ContactEmail = req.ContactEmail
	}

	if err := h.Store.UpdateTenant(c.Request().Context(), tenant); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update tenant"})
	}

	return c.JSON(http.StatusOK, tenant)
}
