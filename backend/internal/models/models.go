package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Tenant struct {
	ID           uuid.UUID              `json:"id"`
	Name         string                 `json:"name"`
	Status       string                 `json:"status"`
	ArchivedAt   *time.Time             `json:"archived_at,omitempty"`
	Settings     map[string]interface{} `json:"settings,omitempty"`
	LogoURL      *string                `json:"logo_url,omitempty"`
	Website      *string                `json:"website,omitempty"`
	ContactEmail *string                `json:"contact_email,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

type UserTenant struct {
	ID       uuid.UUID `json:"id"`
	UserID   uuid.UUID `json:"user_id"`
	TenantID uuid.UUID `json:"tenant_id"`
	Role     string    `json:"role"` // admin, manager, member
	JoinedAt time.Time `json:"joined_at"`
}

type UserWithTenants struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Tenants   []*Tenant `json:"tenants"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type User struct {
	ID               uuid.UUID  `json:"id"`
	TenantID         uuid.UUID  `json:"tenant_id"`
	Email            string     `json:"email"`
	PasswordHash     string     `json:"-"`
	Role             string     `json:"role"` // admin, manager, staff
	IsSuperAdmin     bool       `json:"is_super_admin"`
	QRToken          *string    `json:"-"`
	HasQRToken       bool       `json:"has_qr_token"`
	QRTokenCreatedAt *time.Time `json:"qr_token_created_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type EventStaff struct {
	ID         uuid.UUID `json:"id"`
	EventID    uuid.UUID `json:"event_id"`
	UserID     uuid.UUID `json:"user_id"`
	AssignedAt time.Time `json:"assigned_at"`
	AssignedBy uuid.UUID `json:"assigned_by"`
}

type Event struct {
	ID           uuid.UUID              `json:"id"`
	TenantID     uuid.UUID              `json:"tenant_id"`
	Name         string                 `json:"name"`
	StartDate    *time.Time             `json:"start_date,omitempty"`
	EndDate      *time.Time             `json:"end_date,omitempty"`
	Location     string                 `json:"location,omitempty"`
	FieldSchema  []string               `json:"field_schema,omitempty"`  // Список доступных полей из CSV
	CustomFields map[string]interface{} `json:"custom_fields,omitempty"` // Для хранения настроек, шаблонов и т.д.
	// BadgeTemplate/BadgeTemplateVersion (P3.1) are excluded from generic
	// event JSON (json:"-") — the dedicated GET/PUT
	// /api/events/{id}/badge-template endpoint is the only read/write
	// surface, mirroring the custom_fields PATCH-exclusion precedent at
	// handler/events.go:128. Populate via store.GetEventBadgeTemplate /
	// store.UpdateEventBadgeTemplate, not via the general Event CRUD paths.
	BadgeTemplate        json.RawMessage `json:"-"`
	BadgeTemplateVersion int             `json:"-"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
	DeletedAt            *time.Time      `json:"deleted_at,omitempty"`
}

type Attendee struct {
	ID                    uuid.UUID              `json:"id"`
	EventID               uuid.UUID              `json:"event_id"`
	FirstName             string                 `json:"first_name"`
	LastName              string                 `json:"last_name"`
	Email                 string                 `json:"email"`
	Company               string                 `json:"company"`
	Position              string                 `json:"position"`
	Code                  string                 `json:"code"`
	CheckinStatus         bool                   `json:"checkin_status"`
	CheckedInAt           *time.Time             `json:"checked_in_at,omitempty"`
	CheckedInBy           *uuid.UUID             `json:"checked_in_by,omitempty"`
	CheckedInByEmail      *string                `json:"checked_in_by_email,omitempty"` // Email of user who checked in
	CheckedInDeviceNumber *int                   `json:"checked_in_device_number,omitempty"`
	CheckedInPointName    *string                `json:"checked_in_point_name,omitempty"`
	PrintedCount          int                    `json:"printed_count"`
	Blocked               bool                   `json:"blocked"`
	BlockReason           *string                `json:"block_reason,omitempty"`
	PacketDelivered       bool                   `json:"packet_delivered"`
	RegisteredAt          *time.Time             `json:"registered_at,omitempty"`
	RegistrationZoneID    *uuid.UUID             `json:"registration_zone_id,omitempty"`
	CustomFields          map[string]interface{} `json:"custom_fields,omitempty"`
	CreatedAt             time.Time              `json:"created_at"`
	UpdatedAt             time.Time              `json:"updated_at"`
	DeletedAt             *time.Time             `json:"deleted_at,omitempty"`
}

// Subscription models
type SubscriptionPlan struct {
	ID           uuid.UUID              `json:"id"`
	Name         string                 `json:"name"`
	Slug         string                 `json:"slug"`
	Tier         string                 `json:"tier"` // free, starter, pro, enterprise, custom
	Description  string                 `json:"description"`
	PriceMonthly float64                `json:"price_monthly"`
	PriceYearly  float64                `json:"price_yearly"`
	Limits       map[string]interface{} `json:"limits"`
	Features     map[string]interface{} `json:"features"`
	IsActive     bool                   `json:"is_active"`
	IsPublic     bool                   `json:"is_public"`
	SortOrder    int                    `json:"sort_order"`
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

type Subscription struct {
	ID              uuid.UUID              `json:"id"`
	TenantID        uuid.UUID              `json:"tenant_id"`
	PlanID          *uuid.UUID             `json:"plan_id"`
	Plan            *SubscriptionPlan      `json:"plan,omitempty"`
	Status          string                 `json:"status"` // active, expired, cancelled, trial
	StartDate       time.Time              `json:"start_date"`
	EndDate         *time.Time             `json:"end_date"`
	TrialEndDate    *time.Time             `json:"trial_end_date"`
	CustomLimits    map[string]interface{} `json:"custom_limits,omitempty"`
	CustomFeatures  map[string]interface{} `json:"custom_features,omitempty"`
	PaymentMethod   *string                `json:"payment_method"`
	LastPaymentDate *time.Time             `json:"last_payment_date"`
	NextBillingDate *time.Time             `json:"next_billing_date"`
	AdminNotes      *string                `json:"admin_notes"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
	CreatedBy       *uuid.UUID             `json:"created_by"`
}

type UsageLog struct {
	ID           uuid.UUID              `json:"id"`
	TenantID     uuid.UUID              `json:"tenant_id"`
	ResourceType string                 `json:"resource_type"` // event, attendee, user, api_call
	ResourceID   *uuid.UUID             `json:"resource_id"`
	Action       string                 `json:"action"`
	Quantity     int                    `json:"quantity"`
	Metadata     map[string]interface{} `json:"metadata"`
	LoggedAt     time.Time              `json:"logged_at"`
}

type TenantWithStats struct {
	Tenant         *Tenant       `json:"tenant"`
	Subscription   *Subscription `json:"subscription"`
	UsersCount     int           `json:"users_count"`
	EventsCount    int           `json:"events_count"`
	AttendeesCount int           `json:"attendees_count"`
	LastActivity   *time.Time    `json:"last_activity"`
}

type AdminAuditLog struct {
	ID          uuid.UUID              `json:"id"`
	AdminUserID *uuid.UUID             `json:"admin_user_id"`
	Action      string                 `json:"action"`
	TargetType  string                 `json:"target_type"`
	TargetID    *uuid.UUID             `json:"target_id"`
	Changes     map[string]interface{} `json:"changes"`
	IPAddress   *string                `json:"ip_address"`
	UserAgent   *string                `json:"user_agent"`
	CreatedAt   time.Time              `json:"created_at"`
}

// TimeCount is a single point in a time-bucketed series (signups, checkins).
type TimeCount struct {
	Period string `json:"period"` // YYYY-MM-DD (day) or ISO week start date
	Count  int    `json:"count"`
}

// PlanCount is the tenant count for a single subscription plan.
type PlanCount struct {
	Plan  string `json:"plan"` // plan slug; "none" when tenant has no subscription
	Count int    `json:"count"`
}

// PlatformAnalytics aggregates operator-facing platform metrics (P1.6).
type PlatformAnalytics struct {
	TenantsByStatus map[string]int `json:"tenants_by_status"`
	TenantsByPlan   []PlanCount    `json:"tenants_by_plan"`
	SignupsByWeek   []TimeCount    `json:"signups_by_week"` // last 8 weeks
	ActiveEvents    int            `json:"active_events"`   // running today
	CheckinsByDay   []TimeCount    `json:"checkins_by_day"` // last 14 days
	TotalTenants    int            `json:"total_tenants"`
	PaidTenants     int            `json:"paid_tenants"`    // active sub on a plan with price_monthly > 0
	PaidConversion  float64        `json:"paid_conversion"` // paid / total, 0 when no tenants
}

// Event Zones models
type EventZone struct {
	ID                   uuid.UUID              `json:"id"`
	EventID              uuid.UUID              `json:"event_id"`
	Name                 string                 `json:"name"`
	ZoneType             string                 `json:"zone_type"` // registration, general, vip, workshop
	OrderIndex           int                    `json:"order_index"`
	OpenTime             *string                `json:"open_time,omitempty"` // HH:MM format
	CloseTime            *string                `json:"close_time,omitempty"`
	IsRegistrationZone   bool                   `json:"is_registration_zone"`
	RequiresRegistration bool                   `json:"requires_registration"`
	IsActive             bool                   `json:"is_active"`
	Settings             map[string]interface{} `json:"settings,omitempty"`
	CreatedAt            time.Time              `json:"created_at"`
	UpdatedAt            time.Time              `json:"updated_at"`
}

type ZoneAccessRule struct {
	ID        uuid.UUID `json:"id"`
	ZoneID    uuid.UUID `json:"zone_id"`
	Category  string    `json:"category"`
	Allowed   bool      `json:"allowed"`
	TimeFrom  *string   `json:"time_from,omitempty"` // "HH:MM", inclusive lower bound; nil = no lower bound
	TimeTo    *string   `json:"time_to,omitempty"`   // "HH:MM", inclusive upper bound; nil = no upper bound
	CreatedAt time.Time `json:"created_at"`
}

type AttendeeZoneAccess struct {
	ID         uuid.UUID `json:"id"`
	AttendeeID uuid.UUID `json:"attendee_id"`
	ZoneID     uuid.UUID `json:"zone_id"`
	Allowed    bool      `json:"allowed"`
	Notes      *string   `json:"notes,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ZoneCheckin struct {
	ID          uuid.UUID              `json:"id"`
	AttendeeID  uuid.UUID              `json:"attendee_id"`
	ZoneID      uuid.UUID              `json:"zone_id"`
	CheckedInAt time.Time              `json:"checked_in_at"`
	CheckedInBy *uuid.UUID             `json:"checked_in_by,omitempty"`
	EventDay    time.Time              `json:"event_day"` // Date only
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type StaffZoneAssignment struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"user_id"`
	ZoneID     uuid.UUID  `json:"zone_id"`
	AssignedAt time.Time  `json:"assigned_at"`
	AssignedBy *uuid.UUID `json:"assigned_by,omitempty"`
}

// Extended models for API responses
type EventZoneWithStats struct {
	Zone             *EventZone `json:"zone"`
	TotalCheckins    int        `json:"total_checkins"`
	TodayCheckins    int        `json:"today_checkins"`
	AssignedStaff    int        `json:"assigned_staff"`
	AccessRulesCount int        `json:"access_rules_count"`
}

type ZoneCheckInRequest struct {
	AttendeeCode string    `json:"attendee_code"`
	ZoneID       uuid.UUID `json:"zone_id"`
	EventDay     time.Time `json:"event_day"`
}

type ZoneCheckInResponse struct {
	Success         bool       `json:"success"`
	Attendee        *Attendee  `json:"attendee,omitempty"`
	Zone            *EventZone `json:"zone,omitempty"`
	CheckedInAt     time.Time  `json:"checked_in_at"`
	PacketDelivered bool       `json:"packet_delivered"`
	Message         string     `json:"message,omitempty"`
	Error           string     `json:"error,omitempty"`
}

type ZoneQRData struct {
	ZoneID   string `json:"zone_id"`
	EventID  string `json:"event_id"`
	ZoneName string `json:"zone_name"`
	Type     string `json:"type"` // "zone_select"
}

type MovementHistoryEntry struct {
	ZoneCheckin *ZoneCheckin `json:"checkin"`
	ZoneName    string       `json:"zone_name"`
	ZoneType    string       `json:"zone_type"`
}

// Station represents a provisioned mobile check-in/zone-control/kiosk device.
type Station struct {
	ID           uuid.UUID              `json:"id"`
	EventID      uuid.UUID              `json:"event_id"`
	DeviceNumber int                    `json:"device_number"`
	StaffUserID  uuid.UUID              `json:"staff_user_id"`
	DeviceInfo   map[string]interface{} `json:"device_info,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
}

// StationProvisioningToken is a one-time, short-lived token a manager generates
// (shown as a QR in the web console) to bind a new station to a specific staff user.
type StationProvisioningToken struct {
	Token       string     `json:"-"`
	EventID     uuid.UUID  `json:"event_id"`
	StaffUserID uuid.UUID  `json:"staff_user_id"`
	CreatedBy   uuid.UUID  `json:"created_by"`
	ExpiresAt   time.Time  `json:"expires_at"`
	ConsumedAt  *time.Time `json:"consumed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CreateProvisioningTokenRequest struct {
	StaffUserID uuid.UUID `json:"staff_user_id"`
}

type CreateProvisioningTokenResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ProvisionStationRequest struct {
	Token      string                 `json:"token"`
	DeviceInfo map[string]interface{} `json:"device_info,omitempty"`
}

type ProvisionedStationConfig struct {
	EventID   uuid.UUID `json:"event_id"`
	EventName string    `json:"event_name"`
	StaffName string    `json:"staff_name"`
}

type ProvisionStationResponse struct {
	StationConfig ProvisionedStationConfig `json:"station_config"`
	StaffJWT      string                   `json:"staff_jwt"`
	DeviceNumber  int                      `json:"device_number"`
}

// ZoneScanRequest is the body of POST /api/zones/:zone_id/scan.
type ZoneScanRequest struct {
	Code string `json:"code"`
}

type RegistrationInfo struct {
	Passed bool       `json:"passed"`
	At     *time.Time `json:"at,omitempty"`
	Point  string     `json:"point,omitempty"`
}

// ZoneScanResponse is always HTTP 200 for the three designed verdicts (allowed,
// no_access, not_registered) — they are valid business outcomes the mobile UI
// renders as distinct screens, not error states.
type ZoneScanResponse struct {
	Verdict      string            `json:"verdict"`
	Reason       string            `json:"reason,omitempty"`
	Attendee     *Attendee         `json:"attendee,omitempty"`
	Registration *RegistrationInfo `json:"registration,omitempty"`
	CheckedInAt  *time.Time        `json:"checked_in_at,omitempty"`
	FirstEntry   bool              `json:"first_entry"`
}

// CheckinOverride is the audit-logged staff override ("Всё равно пропустить").
type CheckinOverride struct {
	ID          uuid.UUID  `json:"id"`
	AttendeeID  uuid.UUID  `json:"attendee_id"`
	ZoneID      *uuid.UUID `json:"zone_id,omitempty"`
	Context     string     `json:"context"`
	StaffUserID uuid.UUID  `json:"staff_user_id"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CreateCheckinOverrideRequest struct {
	AttendeeID uuid.UUID  `json:"attendee_id"`
	Context    string     `json:"context"`
	ZoneID     *uuid.UUID `json:"zone_id,omitempty"`
}

// BatchCheckinItem is one entry of the offline-sync batch submitted by a mobile
// client; ClientUUID is the idempotency key for retried submissions.
type BatchCheckinItem struct {
	ClientUUID   uuid.UUID  `json:"client_uuid"`
	AttendeeID   uuid.UUID  `json:"attendee_id"`
	At           time.Time  `json:"at"`
	DeviceNumber int        `json:"device_number"`
	Kind         string     `json:"kind"` // "checkin" | "zone_entry"
	ZoneID       *uuid.UUID `json:"zone_id,omitempty"`
	PointName    *string    `json:"point_name,omitempty"` // registration work-point name from the station's StationConfig; nil for kind=zone_entry
}

type BatchCheckinResult struct {
	ClientUUID uuid.UUID `json:"client_uuid"`
	Status     string    `json:"status"` // "created" | "already_exists" | "error"
	Error      string    `json:"error,omitempty"`
}

type ZoneScanStats struct {
	Allowed       int `json:"allowed"`
	NoAccess      int `json:"no_access"`
	NotRegistered int `json:"not_registered"`
}

type EventStatsResponse struct {
	TotalAttendees int            `json:"total_attendees"`
	CheckedIn      int            `json:"checked_in"`
	ZoneStats      *ZoneScanStats `json:"zone_stats,omitempty"`
}
