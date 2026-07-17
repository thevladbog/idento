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

	// GetCheckinSettings reads the dedicated events.checkin_settings JSONB
	// column (P4.1). Returns (nil, nil) when the column is NULL (no
	// settings saved yet) or when no matching, non-deleted event exists —
	// it never fabricates a settings object, mirroring
	// GetEventBadgeTemplate's not-found idiom. Callers needing to
	// distinguish "no settings" from "no such event" must check existence
	// themselves (e.g. via requireEventOwnership).
	GetCheckinSettings(ctx context.Context, eventID uuid.UUID) (json.RawMessage, error)
	// UpdateCheckinSettings persists settings verbatim (raw bytes, no
	// re-encoding) under a `deleted_at IS NULL` guard — the same race-class
	// guard as UpdateEventBadgeTemplate/IncrementAttendeePrintedCount, but
	// with no optimistic-concurrency version: check-in settings are
	// operator-only config with no concurrent-editor conflict class to
	// guard against. Contract: the caller must already have confirmed the
	// event exists (e.g. via requireEventOwnership) before calling; a
	// 0-row result (the soft-delete race) is a silent no-op, the same
	// idiom as SoftDeleteEvent.
	UpdateCheckinSettings(ctx context.Context, eventID uuid.UUID, settings json.RawMessage) error

	// UpsertCheckinStation registers a check-in station (P4.1 Task 2): a
	// fresh (event_id, name) pair inserts a new row; re-registering the
	// SAME name is idempotent — ON CONFLICT (event_id, name) DO UPDATE
	// replaces zone_id (even back to nil) and refreshes last_seen_at,
	// returning the SAME row/id rather than creating a duplicate. Contract:
	// the caller must already have confirmed the event exists (e.g. via
	// requireEventOwnership) and, when zoneID is non-nil, that it belongs
	// to the SAME event (e.g. via GetEventZoneByID) — this method does not
	// re-validate either.
	UpsertCheckinStation(ctx context.Context, eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error)
	// HeartbeatCheckinStation refreshes a station's last_seen_at, scoped to
	// eventID so a station id belonging to a different event can never be
	// touched. On 0 rows (unknown id, or an id that belongs to a different
	// event) this returns the exported ErrCheckinStationNotFound sentinel —
	// handlers map it to a 404, never a fabricated success.
	HeartbeatCheckinStation(ctx context.Context, eventID, stationID uuid.UUID) error
	// ListCheckinStations returns every station registered for eventID,
	// ordered by name for a deterministic listing.
	ListCheckinStations(ctx context.Context, eventID uuid.UUID) ([]*models.CheckinStation, error)
	// GetCheckinStationByID looks up a single check-in station by id (P4.1
	// Task 3) — used by the check-in/undo endpoints to resolve a
	// caller-supplied station_id into its display name (persisted into
	// checked_in_point_name) and to validate it belongs to the same event as
	// the request path (a foreign station_id is a 400, decided by the
	// handler comparing the returned CheckinStation.EventID). Mirrors
	// GetEventZoneByID: on no matching row this surfaces the raw
	// pgx.ErrNoRows rather than normalizing to (nil, nil) — callers
	// distinguish "unknown id" from "found" via errors.Is(err, pgx.ErrNoRows).
	GetCheckinStationByID(ctx context.Context, id uuid.UUID) (*models.CheckinStation, error)

	// CheckInAttendee performs one station's single-scan check-in
	// idempotently (P4.1 Task 3) — the zero-double-checkin guarantee at the
	// source, mirroring ApplyBatchCheckin's guarded-UPDATE pattern
	// (pg_store_batch.go) but with a RETURNING clause so the full row comes
	// back in the same round trip. In one transaction: a guarded
	// `UPDATE ... WHERE checkin_status = false AND deleted_at IS NULL`
	// RETURNING the row. When it matches (this call wins the race), the
	// outcome is "checked_in" and a checkin_actions ('checkin') row is
	// inserted in the SAME transaction. When it matches nothing, a fallback
	// SELECT (LEFT JOINed to users for checked_in_by_email, mirroring
	// attendeeListColumnsSQL/scanAttendeeRow — attendees has no
	// checked_in_by_email COLUMN; it is always derived from users.email via
	// checked_in_by) distinguishes an attendee that is genuinely missing
	// (soft-deleted, or the id doesn't belong to eventID — returns the
	// exported ErrAttendeeNotFound) from one that is simply already checked
	// in (outcome "already_checked_in", returning its ORIGINAL first-scan
	// metadata — never overwritten; no feed row is written for this path).
	// Contract: the caller must already have confirmed the attendee exists,
	// belongs to eventID, and is NOT blocked (e.g. via
	// requireAttendeeOwnership + an explicit attendee.Blocked check) —
	// this method does not special-case blocked attendees at all; that
	// short-circuit lives in the HANDLER, before this method is ever
	// called. staffEmail/stationName are resolved by the caller (via
	// GetUserByID / GetCheckinStationByID); on the "checked_in" outcome
	// they are attached to the returned row verbatim (an empty stationName
	// leaves checked_in_point_name unset, matching the nullable column).
	CheckInAttendee(ctx context.Context, eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID, staffEmail, stationName string) (outcome string, attendee *models.Attendee, err error)

	// UndoCheckin clears a check-in idempotently (P4.1 Task 3): a guarded
	// `UPDATE ... WHERE checkin_status = true AND deleted_at IS NULL`
	// clearing checkin_status/checked_in_at/checked_in_by/checked_in_point_name
	// (fixing the legacy UpdateAttendeeHandler path's incomplete clear,
	// which never touched checked_in_point_name). When it matches, a
	// checkin_actions ('undo') row is inserted in the SAME transaction.
	// When it matches nothing, a fallback SELECT distinguishes "genuinely
	// missing" (ErrAttendeeNotFound) from "already not checked in"
	// (idempotent no-op — 200, no feed row written). stationID/staffUserID
	// are recorded on the feed row only; they play no part in the guard.
	UndoCheckin(ctx context.Context, eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID) (*models.Attendee, error)

	// GetCheckinActions returns the newest `limit` rows of an event's
	// check-in/undo/reprint feed (P4.1 Task 3), joined to a slim attendee
	// projection — backs the station's recent-scans rail. Ordered newest
	// first (created_at DESC).
	GetCheckinActions(ctx context.Context, eventID uuid.UUID, limit int) ([]CheckinActionRow, error)

	// InsertCheckinAction records one checkin_actions feed row (P4.1 Task
	// 4) — the single shared write path behind CheckInAttendee's 'checkin'
	// row, UndoCheckin's 'undo' row, and the /printed endpoint's 'reprint'
	// row. Called standalone (against the pool, not any existing
	// transaction) by the reprint endpoint, since printed_count's
	// increment and this insert are two separate store calls, not one
	// atomic operation — CheckInAttendee/UndoCheckin do NOT call this
	// method themselves; they run the same underlying insert directly
	// against their own open tx so the feed row commits atomically with
	// the state-changing UPDATE. Contract: the caller has already resolved
	// staffUserID and validated a non-nil stationID belongs to the same
	// event — this method does not re-validate either, and never fails
	// the caller's primary operation (attendee_printed.go treats a
	// failure here as best-effort/non-fatal).
	InsertCheckinAction(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID uuid.UUID) error

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
	// and is not soft-deleted (e.g. via requireAttendeeOwnership) before
	// calling. The UPDATE nevertheless carries a `deleted_at IS NULL` guard
	// (UpdateEventBadgeTemplate precedent — same race class): a concurrent
	// soft-delete can land between the pre-check and this write, and the
	// guard turns that into a 0-row miss instead of incrementing a gone
	// attendee. On 0 rows this returns ErrAttendeeNotFound (reachable ONLY
	// via that race); handlers map it to the house 404 masking.
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

// CheckinActionAttendee is the slim attendee projection embedded in a
// CheckinActionRow — just enough for the station's recent-scans rail to
// render a name/code without pulling the full Attendee row. JSON tags
// match the CheckinActionAttendee openapi schema verbatim.
type CheckinActionAttendee struct {
	ID        uuid.UUID `json:"id"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Code      string    `json:"code"`
}

// CheckinActionRow is one joined row of GetCheckinActions' feed (P4.1 Task
// 3): the checkin_actions row plus its attendee's slim projection. JSON
// tags match the CheckinActionRow openapi schema verbatim (this struct is
// serialized directly by handler.GetCheckinActions).
type CheckinActionRow struct {
	ID        uuid.UUID             `json:"id"`
	Action    string                `json:"action"`
	StationID *uuid.UUID            `json:"station_id,omitempty"`
	CreatedAt time.Time             `json:"created_at"`
	Attendee  CheckinActionAttendee `json:"attendee"`
}
