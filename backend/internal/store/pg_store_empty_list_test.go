package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// These tests pin a systemic gotcha: `var x []*T` left unappended-to by a
// zero-row result set stays a nil Go slice, which encoding/json renders as
// JSON `null` instead of `[]` — crashing any frontend code that does
// `.forEach`/`.map` on the field. Each store method below must return a
// non-nil (possibly empty) slice even when the query matches no rows.

func TestGetUsersByTenantID_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	tenantID := uuid.New()
	mock.ExpectQuery(`FROM users WHERE tenant_id`).
		WithArgs(tenantID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "email", "role", "is_super_admin", "qr_token", "qr_token_created_at", "created_at", "updated_at"}))

	s := &PGStore{db: mock}
	users, err := s.GetUsersByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetUsersByTenantID: %v", err)
	}
	if users == nil {
		t.Fatal("GetUsersByTenantID returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(users) != 0 {
		t.Fatalf("len(users) = %d, want 0", len(users))
	}
}

func TestGetEventStaff_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(`FROM users u`).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "email", "role", "is_super_admin", "qr_token", "qr_token_created_at", "created_at", "updated_at"}))

	s := &PGStore{db: mock}
	staff, err := s.GetEventStaff(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetEventStaff: %v", err)
	}
	if staff == nil {
		t.Fatal("GetEventStaff returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(staff) != 0 {
		t.Fatalf("len(staff) = %d, want 0", len(staff))
	}
}

func TestGetEventsByTenantID_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	tenantID := uuid.New()
	mock.ExpectQuery(`FROM events WHERE tenant_id`).
		WithArgs(tenantID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "start_date", "end_date", "location", "field_schema", "custom_fields", "created_at", "updated_at"}))

	s := &PGStore{db: mock}
	events, err := s.GetEventsByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetEventsByTenantID: %v", err)
	}
	if events == nil {
		t.Fatal("GetEventsByTenantID returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(events) != 0 {
		t.Fatalf("len(events) = %d, want 0", len(events))
	}
}

func TestGetAPIKeysByEventID_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID := uuid.New()
	mock.ExpectQuery(`FROM api_keys`).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "key_hash", "key_hash_bcrypt", "key_preview", "expires_at", "last_used_at", "revoked_at", "created_at"}))

	s := &PGStore{db: mock}
	keys, err := s.GetAPIKeysByEventID(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetAPIKeysByEventID: %v", err)
	}
	if keys == nil {
		t.Fatal("GetAPIKeysByEventID returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(keys) != 0 {
		t.Fatalf("len(keys) = %d, want 0", len(keys))
	}
}

func TestGetUserTenants_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	userID := uuid.New()
	mock.ExpectQuery(`FROM tenants t`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "status", "settings", "logo_url", "website", "contact_email", "created_at", "updated_at"}))

	s := &PGStore{db: mock}
	tenants, err := s.GetUserTenants(context.Background(), userID)
	if err != nil {
		t.Fatalf("GetUserTenants: %v", err)
	}
	if tenants == nil {
		t.Fatal("GetUserTenants returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(tenants) != 0 {
		t.Fatalf("len(tenants) = %d, want 0", len(tenants))
	}
}

func TestGetZoneAccessRules_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	zoneID := uuid.New()
	mock.ExpectQuery(`FROM zone_access_rules`).
		WithArgs(zoneID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "zone_id", "category", "allowed", "time_from", "time_to", "created_at"}))

	s := &PGStore{db: mock}
	rules, err := s.GetZoneAccessRules(context.Background(), zoneID)
	if err != nil {
		t.Fatalf("GetZoneAccessRules: %v", err)
	}
	if rules == nil {
		t.Fatal("GetZoneAccessRules returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(rules) != 0 {
		t.Fatalf("len(rules) = %d, want 0", len(rules))
	}
}

func TestGetAttendeeZoneAccessList_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	attendeeID := uuid.New()
	mock.ExpectQuery(`FROM attendee_zone_access`).
		WithArgs(attendeeID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "attendee_id", "zone_id", "allowed", "notes", "created_at", "updated_at"}))

	s := &PGStore{db: mock}
	accesses, err := s.GetAttendeeZoneAccessList(context.Background(), attendeeID)
	if err != nil {
		t.Fatalf("GetAttendeeZoneAccessList: %v", err)
	}
	if accesses == nil {
		t.Fatal("GetAttendeeZoneAccessList returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(accesses) != 0 {
		t.Fatalf("len(accesses) = %d, want 0", len(accesses))
	}
}

func TestGetStaffZoneAssignments_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	userID := uuid.New()
	mock.ExpectQuery(`FROM staff_zone_assignments\s+WHERE user_id`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "user_id", "zone_id", "assigned_at", "assigned_by"}))

	s := &PGStore{db: mock}
	assignments, err := s.GetStaffZoneAssignments(context.Background(), userID)
	if err != nil {
		t.Fatalf("GetStaffZoneAssignments: %v", err)
	}
	if assignments == nil {
		t.Fatal("GetStaffZoneAssignments returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(assignments) != 0 {
		t.Fatalf("len(assignments) = %d, want 0", len(assignments))
	}
}

func TestGetZoneStaffAssignments_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	zoneID := uuid.New()
	mock.ExpectQuery(`FROM staff_zone_assignments\s+WHERE zone_id`).
		WithArgs(zoneID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "user_id", "zone_id", "assigned_at", "assigned_by"}))

	s := &PGStore{db: mock}
	assignments, err := s.GetZoneStaffAssignments(context.Background(), zoneID)
	if err != nil {
		t.Fatalf("GetZoneStaffAssignments: %v", err)
	}
	if assignments == nil {
		t.Fatal("GetZoneStaffAssignments returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(assignments) != 0 {
		t.Fatalf("len(assignments) = %d, want 0", len(assignments))
	}
}

func TestGetZoneCheckins_NoRowsReturnsEmptyNotNilSlice(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	zoneID := uuid.New()
	at := time.Now()
	mock.ExpectQuery(`FROM zone_checkins`).
		WithArgs(zoneID, at.Truncate(24*time.Hour)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "attendee_id", "zone_id", "checked_in_at", "checked_in_by", "event_day", "metadata"}))

	s := &PGStore{db: mock}
	checkins, err := s.GetZoneCheckins(context.Background(), zoneID, at)
	if err != nil {
		t.Fatalf("GetZoneCheckins: %v", err)
	}
	if checkins == nil {
		t.Fatal("GetZoneCheckins returned nil slice for zero rows, want non-nil empty slice")
	}
	if len(checkins) != 0 {
		t.Fatalf("len(checkins) = %d, want 0", len(checkins))
	}
}
