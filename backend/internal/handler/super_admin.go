package handler

import (
	"idento/backend/internal/models"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// GetAllTenants returns list of all organizations with stats
func (h *Handler) GetAllTenants(c echo.Context) error {
	filters := make(map[string]interface{})
	// TODO: Add filtering support from query params

	tenants, err := h.Store.GetAllTenants(c.Request().Context(), filters)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get tenants",
		})
	}

	return c.JSON(http.StatusOK, tenants)
}

// GetTenantStats returns detailed stats for specific organization
func (h *Handler) GetTenantStats(c echo.Context) error {
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid tenant ID",
		})
	}

	stats, err := h.Store.GetTenantStats(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get tenant stats",
		})
	}

	return c.JSON(http.StatusOK, stats)
}

// GetAllUsersSuper returns list of all users across all tenants
func (h *Handler) GetAllUsersSuper(c echo.Context) error {
	// Pagination
	page := 1
	if pageStr := c.QueryParam("page"); pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
	}

	pageSize := 50
	if pageSizeStr := c.QueryParam("page_size"); pageSizeStr != "" {
		if ps, err := strconv.Atoi(pageSizeStr); err == nil && ps > 0 && ps <= 100 {
			pageSize = ps
		}
	}
	offset := (page - 1) * pageSize

	// Filters
	search := c.QueryParam("search")
	tenantID := c.QueryParam("tenant_id")

	users, total, err := h.Store.GetAllUsers(c.Request().Context(), search, tenantID, pageSize, offset)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get users",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"users":     users,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// UpdateTenantSubscription updates subscription for a tenant
func (h *Handler) UpdateTenantSubscription(c echo.Context) error {
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid tenant ID",
		})
	}

	var req struct {
		PlanID         *string                 `json:"plan_id"`
		Status         *string                 `json:"status"`
		EndDate        *time.Time              `json:"end_date"`
		CustomLimits   *map[string]interface{} `json:"custom_limits"`
		CustomFeatures *map[string]interface{} `json:"custom_features"`
		AdminNotes     *string                 `json:"admin_notes"`
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	// Get existing subscription
	sub, err := h.Store.GetSubscriptionByTenantID(c.Request().Context(), tenantID)
	if err != nil || sub == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Subscription not found",
		})
	}

	// Capture changes for audit
	oldSub := *sub

	// Update fields
	if req.PlanID != nil {
		planID := uuid.MustParse(*req.PlanID)
		sub.PlanID = &planID
	}
	if req.Status != nil {
		sub.Status = *req.Status
	}
	if req.EndDate != nil {
		sub.EndDate = req.EndDate
	}
	if req.CustomLimits != nil {
		sub.CustomLimits = *req.CustomLimits
	}
	if req.CustomFeatures != nil {
		sub.CustomFeatures = *req.CustomFeatures
	}
	if req.AdminNotes != nil {
		sub.AdminNotes = req.AdminNotes
	}

	if err := h.Store.UpdateSubscription(c.Request().Context(), sub); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update subscription",
		})
	}

	// Log admin action
	claims := c.Get("user").(*models.JWTCustomClaims)
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "update_subscription", "subscription", sub.ID, map[string]interface{}{
		"old": oldSub,
		"new": sub,
	}); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}

	return c.JSON(http.StatusOK, sub)
}

// GetSubscriptionPlans returns list of all subscription plans
func (h *Handler) GetSubscriptionPlansSuper(c echo.Context) error {
	includeInactive := c.QueryParam("include_inactive") == "true"

	plans, err := h.Store.GetSubscriptionPlans(c.Request().Context(), includeInactive)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get plans",
		})
	}

	return c.JSON(http.StatusOK, plans)
}

// CreateSubscriptionPlan creates a new subscription plan
func (h *Handler) CreateSubscriptionPlan(c echo.Context) error {
	var plan models.SubscriptionPlan
	if err := c.Bind(&plan); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	if err := h.Store.CreateSubscriptionPlan(c.Request().Context(), &plan); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create plan",
		})
	}

	// Log admin action
	claims := c.Get("user").(*models.JWTCustomClaims)
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "create_plan", "subscription_plan", plan.ID, map[string]interface{}{
		"plan": plan,
	}); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}

	return c.JSON(http.StatusCreated, plan)
}

// UpdateSubscriptionPlanSuper updates a subscription plan
func (h *Handler) UpdateSubscriptionPlanSuper(c echo.Context) error {
	planID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid plan ID",
		})
	}

	var plan models.SubscriptionPlan
	if err := c.Bind(&plan); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request",
		})
	}

	plan.ID = planID

	if err := h.Store.UpdateSubscriptionPlan(c.Request().Context(), &plan); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update plan",
		})
	}

	// Log admin action
	claims := c.Get("user").(*models.JWTCustomClaims)
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "update_plan", "subscription_plan", plan.ID, map[string]interface{}{
		"plan": plan,
	}); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}

	return c.JSON(http.StatusOK, plan)
}

// GetTenantUsage returns usage statistics for a tenant
func (h *Handler) GetTenantUsage(c echo.Context) error {
	tenantID, err := uuid.Parse(c.Param("tenantId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid tenant ID",
		})
	}

	// Get date range from query params (default: last 30 days)
	endDate := time.Now()
	startDate := endDate.AddDate(0, 0, -30)

	if start := c.QueryParam("start_date"); start != "" {
		if parsed, err := time.Parse("2006-01-02", start); err == nil {
			startDate = parsed
		}
	}
	if end := c.QueryParam("end_date"); end != "" {
		if parsed, err := time.Parse("2006-01-02", end); err == nil {
			endDate = parsed
		}
	}

	stats, err := h.Store.GetUsageStats(c.Request().Context(), tenantID, startDate, endDate)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get usage stats",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"tenant_id":  tenantID,
		"start_date": startDate,
		"end_date":   endDate,
		"stats":      stats,
	})
}

// GetSystemAnalytics returns overall system analytics
func (h *Handler) GetSystemAnalytics(c echo.Context) error {
	// TODO: Implement comprehensive system analytics
	return c.JSON(http.StatusOK, map[string]interface{}{
		"message": "Analytics coming soon",
	})
}

// GetAuditLog returns admin audit log
func (h *Handler) GetAuditLog(c echo.Context) error {
	const maxLimit = 100
	limit := 50
	if limitStr := c.QueryParam("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			if l > maxLimit {
				limit = maxLimit
			} else {
				limit = l
			}
		}
	}

	offset := 0
	if offsetStr := c.QueryParam("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	filters := make(map[string]interface{})

	logs, total, err := h.Store.GetAuditLog(c.Request().Context(), filters, limit, offset)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get audit log",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"logs":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}
