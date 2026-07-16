// Package store defines the data access interface for Idento:
// tenants, users, events, attendees, zones, API keys, fonts, subscriptions, usage, and audit.
package store

import (
	"context"
	"encoding/json"
	"idento/backend/internal/models"
	"time"

	"github.com/google/uuid"
)

// Store is the main data access interface; implementations (e.g. PGStore) provide persistence.
type Store interface {
	CreateTenant(ctx context.Context, tenant *models.Tenant) error
	// CreateTenantWithDefaultSubscription creates the tenant and an active
	// subscription to the default plan in one transaction (P0.1: a tenant
	// without a subscription is 403-blocked by the limits middleware).
	CreateTenantWithDefaultSubscription(ctx context.Context, tenant *models.Tenant) error
	// ProvisionTenantWithAdmin registers a tenant end-to-end in one
	// transaction: tenant, default-plan subscription, admin user (created, or
	// reused by email only after the plaintext password verifies against the
	// stored hash — ErrInvalidCredentials otherwise), user_tenants membership.
	// No orphan rows on failure.
	ProvisionTenantWithAdmin(ctx context.Context, tenantName, email, password string) (*models.Tenant, *models.User, error)
	// EnsureSeedData seeds mode-appropriate subscription plans (idempotent).
	EnsureSeedData(ctx context.Context, mode string) error
	GetTenantByID(ctx context.Context, id uuid.UUID) (*models.Tenant, error)
	UpdateTenant(ctx context.Context, tenant *models.Tenant) error
	GetTenantStatus(ctx context.Context, id uuid.UUID) (string, error)
	UpdateTenantStatus(ctx context.Context, id uuid.UUID, status string) error
	// PurgeExpiredTenants hard-deletes tenants archived more than
	// retentionDays ago; see PGStore for detach/cascade/audit semantics.
	PurgeExpiredTenants(ctx context.Context, retentionDays int) ([]PurgedTenant, error)

	CreateUser(ctx context.Context, user *models.User) error
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)
	// HasAnyUsers reports whether the users table has any row at all,
	// across every tenant. Used by on-prem's first-run bootstrap to decide
	// whether the database is a genuinely fresh install.
	HasAnyUsers(ctx context.Context) (bool, error)
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
	// GetEventByIDForTenant returns the event only if it belongs to tenantID;
	// (nil, nil) otherwise — callers cannot distinguish "missing" from "foreign".
	GetEventByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Event, error)
	UpdateEvent(ctx context.Context, event *models.Event) error
	// SoftDeleteEvent marks an event deleted (deleted_at = now()); listings
	// and direct fetches already exclude soft-deleted rows.
	SoftDeleteEvent(ctx context.Context, id uuid.UUID) error

	// GetEventBadgeTemplate reads the dedicated badge_template/
	// badge_template_version column pair (P3.1) — never the legacy
	// custom_fields["badgeTemplate"] key. Returns (nil, 0, nil) when the
	// column is NULL (no template saved yet) or when no matching,
	// non-deleted event exists — it never fabricates a template. Callers
	// needing to distinguish "no template" from "no such event" must check
	// existence themselves (e.g. GetEventByIDForTenant).
	GetEventBadgeTemplate(ctx context.Context, eventID uuid.UUID) (json.RawMessage, int, error)
	// UpdateEventBadgeTemplate persists template verbatim under an optimistic
	// concurrency guard: the UPDATE only matches a row whose current
	// badge_template_version equals expectedVersion, and bumps the version by
	// one. On success it returns the new (bumped) version. When the guard
	// misses (0 rows updated) it returns ErrVersionConflict. Contract: the
	// caller (the badge-template handler, via requireEventOwnership) must
	// already have confirmed the event exists and is not soft-deleted —
	// this method does not re-check event existence, so a 0-row result is
	// always reported as a version conflict, never as "not found".
	UpdateEventBadgeTemplate(ctx context.Context, eventID uuid.UUID, template json.RawMessage, expectedVersion int) (int, error)
	// SyncBadgeTemplateFromLegacy mirrors an object-typed
	// custom_fields["badgeTemplate"] value from the legacy web editor's PUT
	// /api/events/{id} into the dedicated badge_template column. Unlike
	// UpdateEventBadgeTemplate, this write is UNCONDITIONAL — no
	// expected-version guard — because the legacy PUT has no version
	// concept; it always matches by id (excluding soft-deleted rows) and
	// always bumps badge_template_version by one. This deliberately means a
	// concurrent panel badge-editor save's NEXT PUT will 409 — correct
	// cross-editor conflict semantics, not a bug. Callers must log-and-continue
	// on error rather than failing the legacy PUT itself.
	SyncBadgeTemplateFromLegacy(ctx context.Context, eventID uuid.UUID, template json.RawMessage) (int, error)

	CreateAttendee(ctx context.Context, attendee *models.Attendee) error
	// GetAttendeesByEventID lists attendees for an event; code/search are
	// optional filters ("" skips the filter) — code does an exact match,
	// search does a case-insensitive substring match across
	// first/last name, email, and code.
	GetAttendeesByEventID(ctx context.Context, eventID uuid.UUID, code string, search string) ([]*models.Attendee, error)
	// CountAttendeesByEventID counts non-deleted attendees for an event; kept
	// in lockstep with GetAttendeesByEventID's WHERE clause.
	CountAttendeesByEventID(ctx context.Context, eventID uuid.UUID) (int, error)
	// GetAttendeesPage returns one page of attendees for an event matching f,
	// plus the total count of attendees matching f (before paging) — used by
	// GetAttendees' envelope response when page/per_page query params are
	// present. f.Page/f.PerPage are expected to already be validated/defaulted
	// by the caller (page >= 1, 1 <= per_page <= 200) — callers must also
	// ensure (f.Page-1)*f.PerPage does not overflow a signed int before
	// calling; the PGStore implementation re-checks this at the store
	// boundary as defense-in-depth, but does not trust the caller blindly.
	GetAttendeesPage(ctx context.Context, eventID uuid.UUID, f AttendeeFilter) ([]*models.Attendee, int, error)
	GetAttendeeByCode(ctx context.Context, eventID uuid.UUID, code string) (*models.Attendee, error)
	GetAttendeeByID(ctx context.Context, id uuid.UUID) (*models.Attendee, error)
	// GetAttendeeByIDForTenant scopes the attendee through its event's tenant.
	GetAttendeeByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Attendee, error)
	UpdateAttendee(ctx context.Context, attendee *models.Attendee) error
	// IncrementAttendeePrintedCount bumps printed_count by one and returns
	// the new value (backs the attendees table's Printed pill — see
	// reconciliation #6 in
	// docs/superpowers/plans/2026-07-16-panel-p3.2-print-truth.md; this is
	// a counter, not a print journal). Contract: the caller must already
	// have confirmed the attendee exists, belongs to the caller's tenant,
	// and is not soft-deleted (e.g. via requireAttendeeOwnership, which
	// routes through GetAttendeeByIDForTenant -> GetAttendeeByID's
	// `deleted_at IS NULL` filter) before calling — so the UPDATE's WHERE
	// clause is id-only, matching UpdateAttendee's existing precedent
	// (also id-only) rather than re-adding a deleted_at guard here.
	IncrementAttendeePrintedCount(ctx context.Context, attendeeID uuid.UUID) (int, error)

	GetEventsChangedSince(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]*models.Event, error)
	GetAttendeesChangedSince(ctx context.Context, tenantID uuid.UUID, since time.Time) ([]*models.Attendee, error)

	// API Keys for external integrations
	CreateAPIKey(ctx context.Context, apiKey *models.APIKey) error
	GetAPIKeysByEventID(ctx context.Context, eventID uuid.UUID) ([]*models.APIKey, error)
	GetAPIKeyByHash(ctx context.Context, keyHash string) (*models.APIKey, error)
	GetActiveAPIKeys(ctx context.Context) ([]*models.APIKey, error)
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
	// GetPlatformAnalytics aggregates operator-facing platform metrics (P1.6).
	GetPlatformAnalytics(ctx context.Context) (*models.PlatformAnalytics, error)

	// Subscription Plans
	CreateSubscriptionPlan(ctx context.Context, plan *models.SubscriptionPlan) error
	GetSubscriptionPlans(ctx context.Context, includeInactive bool) ([]*models.SubscriptionPlan, error)
	GetSubscriptionPlanByID(ctx context.Context, id uuid.UUID) (*models.SubscriptionPlan, error)
	UpdateSubscriptionPlan(ctx context.Context, plan *models.SubscriptionPlan) error
	GetAllUsers(ctx context.Context, search string, tenantIDFilter string, limit int, offset int) ([]*models.User, int, error)

	// Subscriptions
	UpsertSubscription(ctx context.Context, sub *models.Subscription) error
	GetSubscriptionByTenantID(ctx context.Context, tenantID uuid.UUID) (*models.Subscription, error)
	UpdateSubscription(ctx context.Context, sub *models.Subscription) error
	GetExpiringSubscriptions(ctx context.Context, days int) ([]*models.Subscription, error)

	// Usage Tracking
	LogUsage(ctx context.Context, log *models.UsageLog) error
	GetUsageStats(ctx context.Context, tenantID uuid.UUID, startDate, endDate time.Time) (map[string]int, error)
	CheckTenantLimit(ctx context.Context, tenantID uuid.UUID, limitType string) (bool, int, int, error) // allowed, current, max
	CheckAttendeeLimit(ctx context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error)

	// Audit
	// LogAdminAction records a platform-operator action with request
	// attribution (ip/user_agent from the HTTP request that caused it).
	LogAdminAction(ctx context.Context, adminID uuid.UUID, action string, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error
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
	CheckZoneAccessAt(ctx context.Context, attendeeID, zoneID uuid.UUID, at time.Time) (bool, string, error)
	CreateZoneScanLog(ctx context.Context, zoneID uuid.UUID, attendeeID *uuid.UUID, verdict string) error

	// Attendee Zone Access (individual overrides)
	CreateAttendeeZoneAccess(ctx context.Context, access *models.AttendeeZoneAccess) error
	GetAttendeeZoneAccess(ctx context.Context, attendeeID, zoneID uuid.UUID) (*models.AttendeeZoneAccess, error)
	GetAttendeeZoneAccessByID(ctx context.Context, id uuid.UUID) (*models.AttendeeZoneAccess, error)
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

	// Station Provisioning
	CreateProvisioningToken(ctx context.Context, tok *models.StationProvisioningToken) error
	ConsumeProvisioningToken(ctx context.Context, token string) (*models.StationProvisioningToken, error)
	CreateStation(ctx context.Context, eventID, staffUserID uuid.UUID, deviceInfo map[string]interface{}) (*models.Station, error)

	// Mobile offline-sync batch check-in (idempotent by client_uuid)
	ApplyBatchCheckin(ctx context.Context, eventID, staffUserID uuid.UUID, item *models.BatchCheckinItem) (BatchCheckinOutcome, error)

	// Check-in Overrides (audit log)
	CreateCheckinOverride(ctx context.Context, o *models.CheckinOverride) error

	// Event Stats (KPI counters for mobile status bar)
	GetEventStats(ctx context.Context, eventID uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error)
}

// AttendeeFilter narrows GetAttendeesPage's result set. Every field is
// optional: Code/Search "" skip that filter (same convention as
// GetAttendeesByEventID); ZoneID nil skips the zone-access join; Status nil
// matches any check-in state (true = checked_in, false = not_checked_in).
// Page/PerPage are 1-indexed/positive and expected to already be
// validated/defaulted by the caller — including that (Page-1)*PerPage does
// not overflow a signed int; GetAttendeesPage computes that product as a SQL
// OFFSET and assumes it has already been bounds-checked by the caller.
type AttendeeFilter struct {
	Code    string
	Search  string
	ZoneID  *uuid.UUID
	Status  *bool
	Page    int
	PerPage int
}
