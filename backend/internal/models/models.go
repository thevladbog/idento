package models

import (
	"time"

	"github.com/google/uuid"
)

type Tenant struct {
	ID           uuid.UUID              `json:"id"`
	Name         string                 `json:"name"`
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
	QRToken          *string    `json:"qr_token,omitempty"`
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
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
	DeletedAt    *time.Time             `json:"deleted_at,omitempty"`
}

type Attendee struct {
	ID                 uuid.UUID              `json:"id"`
	EventID            uuid.UUID              `json:"event_id"`
	FirstName          string                 `json:"first_name"`
	LastName           string                 `json:"last_name"`
	Email              string                 `json:"email"`
	Company            string                 `json:"company"`
	Position           string                 `json:"position"`
	Code               string                 `json:"code"`
	CheckinStatus      bool                   `json:"checkin_status"`
	CheckedInAt        *time.Time             `json:"checked_in_at,omitempty"`
	CheckedInBy        *uuid.UUID             `json:"checked_in_by,omitempty"`
	CheckedInByEmail   *string                `json:"checked_in_by_email,omitempty"` // Email of user who checked in
	PrintedCount       int                    `json:"printed_count"`
	Blocked            bool                   `json:"blocked"`
	BlockReason        *string                `json:"block_reason,omitempty"`
	PacketDelivered    bool                   `json:"packet_delivered"`
	RegisteredAt       *time.Time             `json:"registered_at,omitempty"`
	RegistrationZoneID *uuid.UUID             `json:"registration_zone_id,omitempty"`
	CustomFields       map[string]interface{} `json:"custom_fields,omitempty"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
	DeletedAt          *time.Time             `json:"deleted_at,omitempty"`
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
	AdminUserID uuid.UUID              `json:"admin_user_id"`
	Action      string                 `json:"action"`
	TargetType  string                 `json:"target_type"`
	TargetID    *uuid.UUID             `json:"target_id"`
	Changes     map[string]interface{} `json:"changes"`
	IPAddress   *string                `json:"ip_address"`
	UserAgent   *string                `json:"user_agent"`
	CreatedAt   time.Time              `json:"created_at"`
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
