// Package store defines the data access interface for Idento:
// tenants, users, events, attendees, zones, API keys, fonts, subscriptions, usage, and audit.
package store

import (
	"context"
	"encoding/json"
	"errors"
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
	// 0-row result (the soft-delete race) returns the exported
	// ErrEventNotFound sentinel (PR #77 bot-review round, Finding C — this
	// used to be a silent no-op, the same idiom as SoftDeleteEvent, which
	// let the handler respond 200 with settings that were never actually
	// persisted). Handlers map ErrEventNotFound to the house 404 masking.
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
	// `UPDATE ... WHERE checkin_status = false AND blocked = false AND
	// deleted_at IS NULL` RETURNING the row — the SET clause also clears
	// checked_in_device_number (PR #77 bot-review round 2, Finding 2:
	// mirrors UndoCheckin's clear, so a fresh panel check-in never inherits
	// a stale device number left over from an earlier mobile check-in/undo
	// cycle). When it matches (this call wins the race), the outcome is
	// "checked_in" and a checkin_actions ('checkin') row is inserted in the
	// SAME transaction. When it matches nothing, a fallback SELECT (LEFT
	// JOINed to users for checked_in_by_email, mirroring
	// attendeeListColumnsSQL/scanAttendeeRow — attendees has no
	// checked_in_by_email COLUMN; it is always derived from users.email via
	// checked_in_by) distinguishes FOUR cases: an attendee that is genuinely
	// missing (soft-deleted, or the id doesn't belong to eventID — returns
	// the exported ErrAttendeeNotFound, no retry); one that is newly
	// blocked (checkin_status still false, blocked now true — outcome
	// "blocked", PR #77 bot-review round 1 Finding A: closes the TOCTOU
	// race where another operator blocks the SAME attendee in the window
	// between the HANDLER's pre-read short-circuit and this guarded UPDATE
	// actually running, so the blocked = false guard above is what makes
	// this path reachable at all); one that is simply already checked in
	// (outcome "already_checked_in", returning its ORIGINAL first-scan
	// metadata — never overwritten); or — PR #77 bot-review round 2,
	// Finding 1 — one that is neither checked in NOR blocked (checkin_status
	// false, blocked false): a narrow race where the guarded UPDATE lost to
	// something else that then resolved before the fallback SELECT ran.
	// This last case is retried ONCE more against the now-current state
	// (bounded: at most 2 total attempts) rather than being misreported as
	// "already_checked_in" — reporting that outcome here would be doubly
	// wrong: it's factually false, AND since printing only fires on
	// "checked_in", the attendee would walk through with a false verdict and
	// no badge. If the retry lands in the SAME state again, this method
	// returns the exported ErrCheckinConflict for the handler to map to a
	// retryable 409. No feed row is written for the "blocked",
	// "already_checked_in", or ErrCheckinConflict paths. Contract: the
	// caller must already have confirmed the attendee exists, belongs to
	// eventID, and — at the time of its own pre-read — was NOT blocked (e.g.
	// via requireAttendeeOwnership + an explicit attendee.Blocked check) —
	// the HANDLER's pre-read short-circuit is still the primary "blocked"
	// path; this method's own blocked = false guard is the second,
	// race-closing path, not a replacement for the handler's check.
	// staffEmail/stationName are resolved by the caller (via GetUserByID /
	// GetCheckinStationByID); on the "checked_in" outcome they are attached
	// to the returned row verbatim (an empty stationName leaves
	// checked_in_point_name unset, matching the nullable column).
	CheckInAttendee(ctx context.Context, eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID, staffEmail, stationName string) (outcome string, attendee *models.Attendee, err error)

	// UndoCheckin clears a check-in idempotently (P4.1 Task 3): a guarded
	// `UPDATE ... WHERE checkin_status = true AND deleted_at IS NULL`
	// clearing checkin_status/checked_in_at/checked_in_by/
	// checked_in_device_number/checked_in_point_name (fixing the legacy
	// UpdateAttendeeHandler path's incomplete clear, which never touched
	// checked_in_point_name; PR #77 bot-review round Finding B further
	// added checked_in_device_number to this clear list — an attendee
	// checked in via the mobile batch path otherwise kept stale device
	// metadata after a panel undo). When it matches, a
	// checkin_actions ('undo') row is inserted in the SAME transaction.
	// When it matches nothing, a fallback SELECT distinguishes "genuinely
	// missing" (ErrAttendeeNotFound) from "already not checked in"
	// (idempotent no-op — 200, no feed row written). stationID/staffUserID
	// are recorded on the feed row only; they play no part in the guard.
	UndoCheckin(ctx context.Context, eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID) (*models.Attendee, error)

	// GetCheckinActions returns the newest `limit` rows of an event's
	// check-in/undo/reprint feed (P4.1 Task 3), joined to a slim attendee
	// projection — backs the station's recent-scans rail. Ordered newest
	// first (created_at DESC, id DESC as a deterministic tie-breaker for
	// rows sharing the same timestamp — PR #77 bot-review round, Finding
	// E — otherwise concurrent actions at the same created_at could be
	// arbitrarily reordered or omitted across repeated calls with the same
	// LIMIT).
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

	// InsertCheckinActionAt is InsertCheckinAction's explicit-created_at,
	// nullable-staff variant (2026-07-19 event-wide actions-feed design),
	// used by the non-station write paths (mobile batch, legacy attendee
	// PUT, sync push) so the feed row's created_at exactly equals the
	// checked_in_at those paths persisted (nil at → now(); nil staffUserID
	// → NULL). Same contract as InsertCheckinAction otherwise: no
	// re-validation, callers treat failure as best-effort/non-fatal.
	InsertCheckinActionAt(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error

	// TransitionAttendeeCheckinStatus atomically claims a check-in status
	// transition for the legacy write paths (attendee PUT, sync push): one
	// guarded UPDATE flips checkin_status to target ONLY when it currently
	// differs, writing checked_in_at/checked_in_by alongside (cleared when
	// target is false), and reports whether THIS call performed the flip.
	// The database is the arbiter — callers gate their feed-row inserts
	// and monitor publishes on the returned flag, never on a Go-level
	// before/after compare, which two concurrent requests can both pass
	// (each would then insert a duplicate checkin_actions row). Callers
	// still run UpdateAttendee afterwards for the remaining columns and
	// the legacy paths' established overwrite semantics.
	TransitionAttendeeCheckinStatus(ctx context.Context, attendeeID uuid.UUID, target bool, checkedInAt *time.Time, checkedInBy *uuid.UUID) (bool, error)

	// GetMonitorOverview returns the monitor snapshot's total attendee
	// count, currently-checked-in count, every zone's currently-checked-in
	// count, and the count of checked-in attendees that can't be
	// attributed to any zone (unattributed) — ALL FOUR from ONE statement
	// (PR #81 bot-review round, Finding A1; supersedes the former
	// GetMonitorCounts + GetMonitorZones pair), so
	// sum(zones[].CheckedIn) + unattributed == checkedIn holds BY
	// CONSTRUCTION and total/checkedIn can never transiently disagree with
	// zones/unattributed the way two independently-issued statements
	// against a live, concurrently-changing event could (a check-in/undo
	// landing between them). An attendee's zone comes from their MOST
	// RECENT 'checkin' action, but only when no LATER 'undo' supersedes it
	// (Finding A2: a 'reprint' action never participates in this
	// state-changing lookup, since it doesn't change check-in state) —
	// DISTINCT ON (ca.attendee_id) over ('checkin', 'undo') actions, ORDER
	// BY ca.attendee_id, ca.created_at DESC, ca.id DESC, the same id
	// tie-breaker as GetCheckinActions (PR #77 bot-review round, Finding E)
	// — joined through checkin_stations.zone_id to event_zones; a
	// checked-in attendee with no 'checkin' action row, whose latest
	// state-changing action is 'undo' (e.g. checked in, undone, then
	// re-checked-in via a path — like the legacy PUT /api/attendees/{id} —
	// that writes no new action row), a station-less action, or a
	// zone-less station all count into unattributed rather than any zone.
	// Zones are listed in event_zones.order_index order and INCLUDE
	// zero-count zones (LEFT JOIN FROM event_zones, not the other way
	// around, so an empty zone never silently disappears from the list).
	GetMonitorOverview(ctx context.Context, eventID uuid.UUID) (total int, checkedIn int, zones []MonitorZoneCount, unattributed int, err error)

	// GetMonitorMinuteBuckets returns one row per minute (ascending) holding
	// the count of 'checkin' actions in that minute, for created_at >= since
	// (P4.2 Task 2) — a date_trunc('minute', created_at) GROUP BY. The
	// caller passes a UTC start-of-day for the monitor's today's-peak
	// computation ONLY — totals.rate_per_min no longer reuses these buckets
	// (PR #81 bot-review round, Finding A3 moved rate_per_min to the exact
	// CountRecentCheckins query below); GetMonitorMinuteBuckets now backs
	// peak alone.
	GetMonitorMinuteBuckets(ctx context.Context, eventID uuid.UUID, since time.Time) ([]MinuteBucket, error)

	// CountRecentCheckins returns the exact count of 'checkin' actions for
	// eventID at/after since — COUNT(*) FROM checkin_actions WHERE
	// event_id=$1 AND action='checkin' AND created_at>=$2, no minute
	// truncation and no day clamp (PR #81 bot-review round, Finding A3).
	// Backs totals.rate_per_min: the caller passes since =
	// now.Add(-5*time.Minute) and divides the result by 5.0. Replaces the
	// previous bucket-window approach, which (a) excluded an entire
	// minute-START bucket even when most of its seconds fell inside the
	// window (systematic undercount up to ~20%), and (b) clamped to UTC
	// start-of-day, losing the window's reach into "yesterday" for ~5
	// minutes after midnight.
	CountRecentCheckins(ctx context.Context, eventID uuid.UUID, since time.Time) (int, error)

	// GetMonitorStations returns every check-in station for eventID (P4.2
	// Task 2) with its LEFT JOINed 'checkin'-action count — COUNT(...)
	// FILTER (WHERE ca.action = 'checkin'), so 'undo'/'reprint' rows sharing
	// the same station_id don't inflate the count — ordered by name, the
	// same deterministic-listing convention as ListCheckinStations, just
	// with the running count attached for the monitor's stations card.
	GetMonitorStations(ctx context.Context, eventID uuid.UUID) ([]MonitorStation, error)

	CreateAttendee(ctx context.Context, attendee *models.Attendee) error
	// AnalyzeAttendeesTable runs ANALYZE on the attendees table. A bulk
	// insert (e.g. a large CSV import) doesn't trigger a synchronous
	// ANALYZE, and autovacuum's own analyze may not run before the next
	// query -- confirmed empirically during P5.3.5 planning to cause the
	// planner to pick a badly misestimated join plan (~100x slower) for a
	// zone-filtered attendee list query immediately after a 5,000-row
	// bulk insert. Called once per bulk-import request (not per row) from
	// BulkCreateAttendees.
	AnalyzeAttendeesTable(ctx context.Context) error
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

	// Equipment Registry (P4.3): a per-tenant, per-machine device registry
	// keyed by the agent's persisted machine_id (see agent GET /info) —
	// printers/scanners/cameras attached to one physical/virtual machine,
	// scoped so a machine shared across tenants (e.g. a kiosk reassigned
	// between organizations) keeps disjoint registries.

	// UpsertEquipmentMachine registers a machine or refreshes an existing
	// one's hostname/agent_version/last_seen_at — a fresh (tenant_id,
	// machine_id) pair inserts; re-reporting the SAME machine (the agent
	// phones home on every /info poll) is idempotent via ON CONFLICT.
	// seenDeviceIDs additionally touches last_seen_at on every one of THIS
	// tenant/machine's devices the agent's report still names as attached
	// (a second, separate statement — issued only when seenDeviceIDs is
	// non-empty) — a device absent from a report is left untouched, never
	// deleted or flagged, since the agent's own device enumeration is
	// advisory, not authoritative for existence.
	UpsertEquipmentMachine(ctx context.Context, m *models.EquipmentMachine, seenDeviceIDs []uuid.UUID) error
	// GetEquipmentMachine returns the machine row plus every device
	// registered under it, ordered by (class, created_at) — grouped by
	// class in registration order within each group. Returns (nil, nil,
	// nil), never an error, when tenantID/machineID has never been
	// registered (e.g. a fresh agent install that hasn't reported yet) —
	// callers render "not yet registered" without special-casing an error
	// type, mirroring GetEventByIDForTenant's not-found idiom.
	GetEquipmentMachine(ctx context.Context, tenantID, machineID uuid.UUID) (*models.EquipmentMachine, []models.EquipmentDevice, error)
	// GetEquipmentDeviceForTenant looks up a single device scoped by
	// tenant_id alone (not machine_id) — callers needing to further confirm
	// it belongs to a specific machine compare the returned MachineID
	// themselves. Returns (nil, nil) when the id doesn't exist OR belongs
	// to a different tenant — callers cannot distinguish "missing" from
	// "foreign" from this method alone (same contract as
	// GetEventByIDForTenant/GetAttendeeByIDForTenant).
	GetEquipmentDeviceForTenant(ctx context.Context, tenantID, deviceID uuid.UUID) (*models.EquipmentDevice, error)
	// ListEquipmentPrintersForTenant returns every class=printer,
	// kind=network device across ALL of the tenant's machines, each paired
	// with its machine's hostname, for the pairing-QR CSV export. Ordered by
	// (hostname, display_name). Returns an empty (non-nil) slice when the
	// tenant has no network printers.
	ListEquipmentPrintersForTenant(ctx context.Context, tenantID uuid.UUID) ([]models.EquipmentPrinterExport, error)
	// CreateEquipmentDevice inserts a new device under d.TenantID/d.MachineID
	// and fills d.ID/d.CreatedAt/d.UpdatedAt/d.TestPassedAt from the
	// INSERT's RETURNING clause (all four are DB-generated/DB-computed).
	// d.IsDefault is set to makeDefault, overwriting whatever the caller
	// had set on d. testPassed, when true, stamps test_passed_at = now()
	// IN THE SAME INSERT statement (Finding 2, bot review PR #83 round 2)
	// — callers must NOT additionally call MarkEquipmentDeviceTestPassed
	// after a testPassed=true create; that would reintroduce the
	// create-then-separate-stamp window this atomicity exists to close
	// (the create committing while the second write fails, leaving an
	// already-visible, wrongly-unstamped device that a retry then
	// 409s/duplicates against). When makeDefault is true this runs inside
	// a transaction that first clears any existing default printer for the
	// SAME (tenant_id, machine_id) — the same clear-then-set shape as
	// SetDefaultEquipmentPrinter — so a crash between the two statements
	// can never leave two printers marked default; when false it is a
	// plain, non-transactional INSERT. The caller is responsible for only
	// passing makeDefault=true for a class="printer" device — this method
	// does not itself re-validate class, relying on the
	// equipment_devices_default_is_printer CHECK constraint as the
	// last-resort guard.
	CreateEquipmentDevice(ctx context.Context, d *models.EquipmentDevice, makeDefault bool, testPassed bool) error
	// UpdateEquipmentDevice renames a device and/or replaces its config —
	// the only two caller-editable columns (class/kind/machine_id are
	// immutable once created; is_default is repointed only via
	// SetDefaultEquipmentPrinter, never here). test_passed_at is cleared
	// UNCONDITIONALLY whenever the supplied config differs (by jsonb-
	// semantic equality — key order/whitespace insensitive) from the
	// device's CURRENT config: a stamp recorded against one config must
	// never be left describing DIFFERENT hardware after a config swap
	// (Finding 1, bot review PR #83 round 2) — this is enforced at the SQL
	// level (an UPDATE ... CASE over the OLD row), not left to callers to
	// remember. A rename-only call (config unchanged) preserves the
	// existing stamp. On 0 rows (unknown id, or an id belonging to a
	// different tenant) this returns the exported ErrDeviceNotFound
	// sentinel.
	UpdateEquipmentDevice(ctx context.Context, tenantID, deviceID uuid.UUID, displayName string, config json.RawMessage) error
	// DeleteEquipmentDevice removes a device outright. No special-case code
	// exists for "was this the default printer" — the row (and the partial
	// unique index entry it held) is simply gone; the spec deliberately
	// forbids silently promoting another device to default on delete. On 0
	// rows this returns ErrDeviceNotFound.
	DeleteEquipmentDevice(ctx context.Context, tenantID, deviceID uuid.UUID) error
	// SetDefaultEquipmentPrinter repoints the default printer for one
	// (tenant_id, machine_id): inside a transaction, it first clears any
	// existing default for that machine, then — when deviceID is non-nil —
	// sets the new one, guarded on class = 'printer' so a scanner/camera id
	// can never become the default. deviceID = nil clears the default with
	// no replacement (clear-only, not wrapped in a transaction since it is
	// a single statement) — 0 rows affected by the clear is NOT an error
	// (there may have been no previous default). When deviceID is non-nil
	// and the guarded set-UPDATE affects 0 rows (the id doesn't exist,
	// belongs to a different tenant/machine, or isn't a printer), the
	// WHOLE transaction rolls back — including the clear — so the prior
	// default (if any) is left exactly as it was, never silently promoted
	// to some other device and never left with zero defaults either; this
	// returns ErrDeviceNotFound.
	SetDefaultEquipmentPrinter(ctx context.Context, tenantID, machineID uuid.UUID, deviceID *uuid.UUID) error
	// MarkEquipmentDeviceTestPassed stamps test_passed_at = now() on a
	// successful test-print/test-scan (the panel wizard's "Test" step). On
	// 0 rows this returns ErrDeviceNotFound.
	MarkEquipmentDeviceTestPassed(ctx context.Context, tenantID, deviceID uuid.UUID) error
	// TenantHasTestedDefaultPrinter reports whether ANY device across ANY
	// of the tenant's machines is currently the default printer AND has a
	// non-null test_passed_at — the equipment-readiness gate's underlying
	// query (Task 4 wires this into the readiness endpoint alongside the
	// existing checks).
	TenantHasTestedDefaultPrinter(ctx context.Context, tenantID uuid.UUID) (bool, error)
}

// ErrDeviceNotFound is the equipment registry's not-found sentinel —
// sibling of ErrEventNotFound/ErrCheckinStationNotFound/ErrAttendeeNotFound:
// UpdateEquipmentDevice, DeleteEquipmentDevice, MarkEquipmentDeviceTestPassed,
// and SetDefaultEquipmentPrinter (when deviceID is non-nil) all return this
// on their guarded statement affecting 0 rows — a device that doesn't exist,
// belongs to a different tenant, or (SetDefaultEquipmentPrinter only) isn't
// a printer of the target machine. Handlers map it to the house 404 masking,
// the same convention as every other *NotFound sentinel in this package.
var ErrDeviceNotFound = errors.New("equipment device not found")

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

// MonitorZoneCount is one zone's currently-checked-in count, one element of
// GetMonitorZones' result (P4.2 Task 2). Zero-count zones are included, so
// this is never a sparse/omit-if-empty list — the caller (the monitor
// endpoint, Task 3) reshapes this into the wire schema.
type MonitorZoneCount struct {
	ZoneID    uuid.UUID
	Name      string
	CheckedIn int
}

// MinuteBucket is one date_trunc('minute', created_at) bucket from
// GetMonitorMinuteBuckets (P4.2 Task 2) — the single shared source for both
// the monitor's per-5-minute check-in rate and its today's-peak computation
// (Task 3's computeRates), so the two numbers are always reading the same
// underlying data.
type MinuteBucket struct {
	Minute time.Time
	Count  int
}

// MonitorStation is one check-in station plus its running 'checkin'-action
// count, from GetMonitorStations (P4.2 Task 2) — backs the monitor's
// stations card (name, zone, last-seen staleness, and how many check-ins it
// has processed so far).
type MonitorStation struct {
	ID           uuid.UUID
	Name         string
	ZoneID       *uuid.UUID
	LastSeenAt   time.Time
	CheckinCount int
}
