package store

import (
	"context"
	"idento/backend/internal/models"
	"time"

	"github.com/google/uuid"
)

type Store interface {
	CreateTenant(ctx context.Context, tenant *models.Tenant) error
	GetTenantByID(ctx context.Context, id uuid.UUID) (*models.Tenant, error)
	UpdateTenant(ctx context.Context, tenant *models.Tenant) error

	CreateUser(ctx context.Context, user *models.User) error
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error)
	GetUsersByTenantID(ctx context.Context, tenantID uuid.UUID) ([]*models.User, error)
	GetUserByQRToken(ctx context.Context, token string) (*models.User, error)
	UpdateUserQRToken(ctx context.Context, userID uuid.UUID, token string, createdAt time.Time) error

	// Multi-organization support
	AddUserToTenant(ctx context.Context, userTenant *models.UserTenant) error
	RemoveUserFromTenant(ctx context.Context, userID, tenantID uuid.UUID) error
	GetUserTenants(ctx context.Context, userID uuid.UUID) ([]*models.Tenant, error)
	GetUserTenantRole(ctx context.Context, userID, tenantID uuid.UUID) (string, error)
	UpdateUserTenantRole(ctx context.Context, userID, tenantID uuid.UUID, role string) error

	AssignStaffToEvent(ctx context.Context, assignment *models.EventStaff) error
	GetEventStaff(ctx context.Context, eventID uuid.UUID) ([]*models.User, error)
	RemoveStaffFromEvent(ctx context.Context, eventID, userID uuid.UUID) error
	GetUserEvents(ctx context.Context, userID uuid.UUID) ([]*models.Event, error)

	CreateEvent(ctx context.Context, event *models.Event) error
	GetEventsByTenantID(ctx context.Context, tenantID uuid.UUID) ([]*models.Event, error)
	GetEventByID(ctx context.Context, id uuid.UUID) (*models.Event, error)
	UpdateEvent(ctx context.Context, event *models.Event) error

	CreateAttendee(ctx context.Context, attendee *models.Attendee) error
	GetAttendeesByEventID(ctx context.Context, eventID uuid.UUID) ([]*models.Attendee, error)
	GetAttendeeByCode(ctx context.Context, eventID uuid.UUID, code string) (*models.Attendee, error)
	GetAttendeeByID(ctx context.Context, id uuid.UUID) (*models.Attendee, error)
	UpdateAttendee(ctx context.Context, attendee *models.Attendee) error

	GetEventsChangedSince(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]*models.Event, error)
	GetAttendeesChangedSince(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]*models.Attendee, error)

	// API Keys for external integrations
	CreateAPIKey(ctx context.Context, apiKey *models.APIKey) error
	GetAPIKeysByEventID(ctx context.Context, eventID uuid.UUID) ([]*models.APIKey, error)
	GetAPIKeyByHash(ctx context.Context, keyHash string) (*models.APIKey, error)
	RevokeAPIKey(ctx context.Context, id uuid.UUID) error
	UpdateAPIKeyLastUsed(ctx context.Context, id uuid.UUID) error

	// Fonts for badge printing (per event)
	CreateFont(ctx context.Context, font *models.Font) error
	GetFontsByEventID(ctx context.Context, eventID uuid.UUID) ([]*models.FontListItem, error)
	GetFontByID(ctx context.Context, id uuid.UUID) (*models.Font, error)
	DeleteFont(ctx context.Context, id uuid.UUID) error

	// Super Admin - Organizations Management
	GetAllTenants(ctx context.Context, filters map[string]interface{}) ([]*models.TenantWithStats, error)
	GetTenantStats(ctx context.Context, tenantID uuid.UUID) (*models.TenantWithStats, error)

	// Subscription Plans
	CreateSubscriptionPlan(ctx context.Context, plan *models.SubscriptionPlan) error
	GetSubscriptionPlans(ctx context.Context, includeInactive bool) ([]*models.SubscriptionPlan, error)
	GetSubscriptionPlanByID(ctx context.Context, id uuid.UUID) (*models.SubscriptionPlan, error)
	UpdateSubscriptionPlan(ctx context.Context, plan *models.SubscriptionPlan) error
	GetAllUsers(ctx context.Context, search string, tenantIDFilter string, limit int, offset int) ([]*models.User, int, error)

	// Subscriptions
	CreateSubscription(ctx context.Context, sub *models.Subscription) error
	GetSubscriptionByTenantID(ctx context.Context, tenantID uuid.UUID) (*models.Subscription, error)
	UpdateSubscription(ctx context.Context, sub *models.Subscription) error
	GetExpiringSubscriptions(ctx context.Context, days int) ([]*models.Subscription, error)

	// Usage Tracking
	LogUsage(ctx context.Context, log *models.UsageLog) error
	GetUsageStats(ctx context.Context, tenantID uuid.UUID, startDate, endDate time.Time) (map[string]int, error)
	CheckTenantLimit(ctx context.Context, tenantID uuid.UUID, limitType string) (bool, int, int, error) // allowed, current, max

	// Audit
	LogAdminAction(ctx context.Context, adminID uuid.UUID, action string, targetType string, targetID uuid.UUID, changes interface{}) error
	GetAuditLog(ctx context.Context, filters map[string]interface{}, limit int, offset int) ([]*models.AdminAuditLog, int, error)

	// Event Zones
	CreateEventZone(ctx context.Context, zone *models.EventZone) error
	GetEventZones(ctx context.Context, eventID uuid.UUID) ([]*models.EventZone, error)
	GetEventZoneByID(ctx context.Context, id uuid.UUID) (*models.EventZone, error)
	UpdateEventZone(ctx context.Context, zone *models.EventZone) error
	DeleteEventZone(ctx context.Context, id uuid.UUID) error
	GetEventZonesWithStats(ctx context.Context, eventID uuid.UUID) ([]*models.EventZoneWithStats, error)

	// Zone Access Rules
	CreateZoneAccessRule(ctx context.Context, rule *models.ZoneAccessRule) error
	GetZoneAccessRules(ctx context.Context, zoneID uuid.UUID) ([]*models.ZoneAccessRule, error)
	DeleteZoneAccessRule(ctx context.Context, id uuid.UUID) error
	BulkUpdateZoneAccessRules(ctx context.Context, zoneID uuid.UUID, rules []*models.ZoneAccessRule) error

	// Attendee Zone Access (individual overrides)
	CreateAttendeeZoneAccess(ctx context.Context, access *models.AttendeeZoneAccess) error
	GetAttendeeZoneAccess(ctx context.Context, attendeeID, zoneID uuid.UUID) (*models.AttendeeZoneAccess, error)
	GetAttendeeZoneAccessList(ctx context.Context, attendeeID uuid.UUID) ([]*models.AttendeeZoneAccess, error)
	UpdateAttendeeZoneAccess(ctx context.Context, access *models.AttendeeZoneAccess) error
	DeleteAttendeeZoneAccess(ctx context.Context, id uuid.UUID) error

	// Zone Check-ins
	CreateZoneCheckin(ctx context.Context, checkin *models.ZoneCheckin) error
	GetZoneCheckins(ctx context.Context, zoneID uuid.UUID, date time.Time) ([]*models.ZoneCheckin, error)
	GetAttendeeZoneCheckins(ctx context.Context, attendeeID uuid.UUID) ([]*models.ZoneCheckin, error)
	CheckAttendeeZoneCheckin(ctx context.Context, attendeeID, zoneID uuid.UUID, date time.Time) (*models.ZoneCheckin, error)

	// Staff Zone Assignments
	AssignStaffToZone(ctx context.Context, assignment *models.StaffZoneAssignment) error
	GetStaffZoneAssignments(ctx context.Context, userID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	GetZoneStaffAssignments(ctx context.Context, zoneID uuid.UUID) ([]*models.StaffZoneAssignment, error)
	RemoveStaffFromZone(ctx context.Context, userID, zoneID uuid.UUID) error

	// Access Validation
	CheckZoneAccess(ctx context.Context, attendeeID, zoneID uuid.UUID) (bool, string, error) // allowed, reason, error
}
