package handler

import (
	"fmt"
	"idento/backend/internal/models"
	"log"
	"net/http"
	"strconv"
	"strings"
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

	// Get existing subscription; create one if the tenant has none (upsert).
	sub, err := h.Store.GetSubscriptionByTenantID(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load subscription",
		})
	}
	isNew := false
	if sub == nil {
		if req.PlanID == nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Tenant has no subscription; plan_id is required to create one",
			})
		}
		sub = &models.Subscription{TenantID: tenantID, Status: "active", StartDate: time.Now()}
		isNew = true
	}

	// Capture changes for audit
	oldSub := *sub

	// Update fields
	if req.PlanID != nil {
		planID, err := uuid.Parse(*req.PlanID)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid plan ID format",
			})
		}
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

	if isNew {
		if err := h.Store.UpsertSubscription(c.Request().Context(), sub); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create subscription"})
		}
	} else {
		if err := h.Store.UpdateSubscription(c.Request().Context(), sub); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update subscription"})
		}
	}

	// Log admin action
	action := "update_subscription"
	if isNew {
		action = "create_subscription"
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, action, "subscription", sub.ID, map[string]interface{}{
		"old": oldSub,
		"new": sub,
	}, c.RealIP(), c.Request().UserAgent()); err != nil {
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
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "create_plan", "subscription_plan", plan.ID, map[string]interface{}{
		"plan": plan,
	}, c.RealIP(), c.Request().UserAgent()); err != nil {
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
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "update_plan", "subscription_plan", plan.ID, map[string]interface{}{
		"plan": plan,
	}, c.RealIP(), c.Request().UserAgent()); err != nil {
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

// GetSystemAnalytics returns operator-facing platform aggregates (P1.6).
func (h *Handler) GetSystemAnalytics(c echo.Context) error {
	analytics, err := h.Store.GetPlatformAnalytics(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to compute analytics"})
	}
	return c.JSON(http.StatusOK, analytics)
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
	if action := c.QueryParam("action"); action != "" {
		filters["action"] = action
	}
	if targetIDStr := c.QueryParam("target_id"); targetIDStr != "" {
		if targetID, err := uuid.Parse(targetIDStr); err == nil {
			filters["target_id"] = targetID
		}
	}

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

// CreateTenantSuper lets a platform operator provision an organization
// manually (subscription to the default plan is created transactionally).
func (h *Handler) CreateTenantSuper(c echo.Context) error {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.Bind(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	tenant := &models.Tenant{Name: strings.TrimSpace(req.Name)}
	if err := h.Store.CreateTenantWithDefaultSubscription(c.Request().Context(), tenant); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create tenant"})
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "create_tenant", "tenant", tenant.ID, map[string]interface{}{"name": tenant.Name}, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusCreated, tenant)
}

// lifecycle transition table: action → (required current state, new state).
var tenantTransitions = map[string]struct{ from, to string }{
	"suspend":    {"active", "suspended"},
	"reactivate": {"suspended", "active"},
	"archive":    {"suspended", "archived"},
}

func (h *Handler) setTenantStatus(c echo.Context, action string) error {
	tr := tenantTransitions[action]
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}
	var body struct {
		Reason string `json:"reason"`
	}
	//nolint:errcheck
	_ = c.Bind(&body) // optional body; malformed/absent JSON leaves body.Reason == ""
	current, err := h.Store.GetTenantStatus(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load tenant"})
	}
	if current == "" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}
	if current != tr.from {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": fmt.Sprintf("cannot %s a tenant in state %q (requires %q)", action, current, tr.from),
		})
	}
	if err := h.Store.UpdateTenantStatus(c.Request().Context(), tenantID, tr.to); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update tenant status"})
	}
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	adminID := uuid.MustParse(claims.UserID)
	changes := map[string]interface{}{"from": current, "to": tr.to}
	if body.Reason != "" {
		changes["reason"] = body.Reason
	}
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, action+"_tenant", "tenant", tenantID, changes, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusOK, map[string]string{"status": tr.to})
}

func (h *Handler) SuspendTenant(c echo.Context) error    { return h.setTenantStatus(c, "suspend") }
func (h *Handler) ReactivateTenant(c echo.Context) error { return h.setTenantStatus(c, "reactivate") }
func (h *Handler) ArchiveTenant(c echo.Context) error    { return h.setTenantStatus(c, "archive") }

// ImpersonateTenant mints a 30-minute support session inside the target
// tenant. Requires an active tenant; refuses nested impersonation.
func (h *Handler) ImpersonateTenant(c echo.Context) error {
	claims, err := claimsFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}
	if claims.ImpersonatedBy != "" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "nested impersonation is not allowed"})
	}
	tenantID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tenant ID"})
	}
	var body struct {
		Reason string `json:"reason"`
	}
	//nolint:errcheck
	_ = c.Bind(&body)
	status, err := h.Store.GetTenantStatus(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load tenant"})
	}
	if status == "" {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Tenant not found"})
	}
	if status != "active" {
		hint := "reactivate before impersonating"
		if status == "archived" {
			hint = "archived tenants cannot be impersonated"
		}
		return c.JSON(http.StatusConflict, map[string]string{"error": "tenant is " + status + " — " + hint})
	}
	token, expiresAt, err := generateImpersonationToken(claims.UserID, tenantID.String())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mint impersonation token"})
	}
	adminID := uuid.MustParse(claims.UserID)
	changes := map[string]interface{}{"expires_at": expiresAt}
	if body.Reason != "" {
		changes["reason"] = body.Reason
	}
	if err := h.Store.LogAdminAction(c.Request().Context(), adminID, "impersonate_tenant", "tenant", tenantID, changes, c.RealIP(), c.Request().UserAgent()); err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":      token,
		"expires_at": expiresAt,
		"tenant_id":  tenantID,
	})
}
