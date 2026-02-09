// Package handler provides HTTP handlers for the Idento REST API:
// auth (register, login, QR login), tenants, users, events, attendees,
// zones, API keys, fonts, sync, and super-admin endpoints.
package handler

import (
	"idento/backend/internal/middleware"
	"idento/backend/internal/store"

	"github.com/labstack/echo/v4"
)

// Handler holds dependencies (e.g. Store) and implements HTTP handlers for the API.
type Handler struct {
	Store store.Store
}

// New returns a new Handler with the given store.
func New(s store.Store) *Handler {
	return &Handler{Store: s}
}

// RegisterRoutes mounts all API routes on the given Echo instance.
func (h *Handler) RegisterRoutes(e *echo.Echo) {
	// Auth routes
	auth := e.Group("/auth")
	auth.POST("/register", h.Register)
	auth.POST("/login", h.Login)
	auth.POST("/login-qr", h.LoginWithQR)

	// Protected routes
	api := e.Group("/api")
	api.Use(middleware.JWT())
	api.GET("/me", h.GetMe)
	api.POST("/auth/switch-tenant", h.SwitchTenant)

	// Tenants/Organizations
	api.GET("/tenants", h.GetUserTenants)
	api.GET("/tenants/:id", h.GetTenant)
	api.PUT("/tenants/:id", h.UpdateTenant)

	// Users
	api.GET("/users", h.GetUsers)
	api.POST("/users", h.CreateUser, middleware.CheckLimits(h.Store, "users"))
	api.POST("/users/:id/qr-token", h.GenerateQRToken)

	// Events
	api.GET("/events", h.GetEvents)
	api.GET("/events/:id", h.GetEvent)
	api.POST("/events", h.CreateEvent, middleware.CheckLimits(h.Store, "events_per_month"))
	api.PUT("/events/:id", h.UpdateEvent)
	api.GET("/events/:event_id/staff", h.GetEventStaff)
	api.POST("/events/:event_id/staff", h.AssignStaffToEvent)

	// Attendees
	api.GET("/events/:event_id/attendees", h.GetAttendees)
	api.POST("/events/:event_id/attendees", h.CreateAttendee, middleware.CheckLimits(h.Store, "attendees_per_event"))
	api.POST("/events/:event_id/attendees/bulk", h.BulkCreateAttendees, middleware.CheckLimits(h.Store, "attendees_per_event"))
	api.POST("/events/:event_id/attendees/generate-codes", h.GenerateAttendeeCodes)
	api.GET("/events/:event_id/attendees/export", h.ExportAttendeesCSV)
	api.GET("/attendees/:id/qr", h.GetAttendeeQR)
	api.PUT("/attendees/:id", h.UpdateAttendeeHandler)    // For check-in status
	api.PATCH("/attendees/:id", h.UpdateAttendeeInfo)     // For full info update
	api.POST("/attendees/:id/block", h.BlockAttendee)     // Block with reason
	api.POST("/attendees/:id/unblock", h.UnblockAttendee) // Unblock
	api.DELETE("/attendees/:id", h.DeleteAttendee)        // Soft delete

	// Event Zones
	api.POST("/events/:event_id/zones", h.CreateEventZone)
	api.GET("/events/:event_id/zones", h.GetEventZones)
	api.GET("/zones/:id", h.GetEventZone)
	api.PUT("/zones/:id", h.UpdateEventZone)
	api.DELETE("/zones/:id", h.DeleteEventZone)
	api.GET("/zones/:id/qr", h.GetZoneQRCode)

	// Zone Access Rules
	api.POST("/zones/:zone_id/access-rules", h.CreateZoneAccessRule)
	api.GET("/zones/:zone_id/access-rules", h.GetZoneAccessRules)
	api.PUT("/zones/:zone_id/access-rules", h.BulkUpdateZoneAccessRules)

	// Individual Attendee Access
	api.POST("/attendees/:attendee_id/zone-access", h.CreateAttendeeZoneAccess)
	api.GET("/attendees/:attendee_id/zone-access", h.GetAttendeeZoneAccess)
	api.PUT("/attendee-zone-access/:id", h.UpdateAttendeeZoneAccess)
	api.DELETE("/attendee-zone-access/:id", h.DeleteAttendeeZoneAccess)

	// Staff Zone Assignments
	api.POST("/zones/:zone_id/staff", h.AssignStaffToZone)
	api.GET("/zones/:zone_id/staff", h.GetZoneStaff)
	api.DELETE("/zones/:zone_id/staff/:user_id", h.RemoveStaffFromZone)
	api.GET("/users/:user_id/zones", h.GetUserZoneAssignments)

	// Zone Check-in
	api.POST("/zones/checkin", h.ZoneCheckIn)
	api.GET("/zones/:zone_id/checkins", h.GetZoneCheckins)
	api.GET("/attendees/:attendee_id/zone-history", h.GetAttendeeZoneHistory)

	// Mobile API - filtered by staff permissions
	api.GET("/mobile/events/:event_id/zones", h.GetAvailableZones)
	api.GET("/mobile/zones/:zone_id/days", h.GetZoneDays)

	// Sync
	api.GET("/sync", h.SyncPull)
	api.POST("/sync", h.SyncPush)

	// API Keys management
	api.GET("/events/:event_id/api-keys", h.GetAPIKeys)
	api.POST("/events/:event_id/api-keys", h.CreateAPIKey)
	api.DELETE("/events/:event_id/api-keys/:key_id", h.RevokeAPIKey)

	// Fonts management (per event)
	api.GET("/events/:event_id/fonts", h.GetEventFonts)
	api.POST("/events/:event_id/fonts", h.UploadEventFont)
	api.GET("/events/:event_id/fonts/css", h.GetEventFontCSS)
	api.DELETE("/events/:event_id/fonts/:font_id", h.DeleteEventFont)
	api.GET("/fonts/:id/file", h.GetFontFile) // Public font file endpoint

	// Public API endpoints (with API key authentication)
	public := e.Group("/api/public")
	public.POST("/import", h.ExternalImport, middleware.APIKeyAuth(h.Store))

	// Super Admin routes
	superAdmin := api.Group("/super-admin")
	superAdmin.Use(middleware.SuperAdminOnly(h.Store))

	// Tenants
	superAdmin.GET("/tenants", h.GetAllTenants)
	superAdmin.GET("/tenants/:id/stats", h.GetTenantStats)
	superAdmin.PATCH("/tenants/:id/subscription", h.UpdateTenantSubscription)

	// Users
	superAdmin.GET("/users", h.GetAllUsersSuper)

	// Plans
	superAdmin.GET("/plans", h.GetSubscriptionPlansSuper)
	superAdmin.POST("/plans", h.CreateSubscriptionPlan)
	superAdmin.PUT("/plans/:id", h.UpdateSubscriptionPlanSuper)

	// Usage & Analytics
	superAdmin.GET("/usage/:tenantId", h.GetTenantUsage)
	superAdmin.GET("/analytics", h.GetSystemAnalytics)
	superAdmin.GET("/audit-log", h.GetAuditLog)
}
