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
func TestPGStore_EmptyResultsReturnEmptySliceNotNil(t *testing.T) {
	type testCase struct {
		name  string
		setup func(mock pgxmock.PgxPoolIface, id uuid.UUID, at time.Time)
		run   func(s *PGStore, id uuid.UUID, at time.Time) (length int, isNil bool, err error)
	}

	cases := []testCase{
		{
			name: "GetUsersByTenantID",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM users WHERE tenant_id`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "email", "role", "is_super_admin", "qr_token", "qr_token_created_at", "created_at", "updated_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				users, err := s.GetUsersByTenantID(context.Background(), id)
				return len(users), users == nil, err
			},
		},
		{
			name: "GetEventStaff",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM users u`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "email", "role", "is_super_admin", "qr_token", "qr_token_created_at", "created_at", "updated_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				staff, err := s.GetEventStaff(context.Background(), id)
				return len(staff), staff == nil, err
			},
		},
		{
			name: "GetEventsByTenantID",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM events WHERE tenant_id`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "start_date", "end_date", "location", "field_schema", "custom_fields", "created_at", "updated_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				events, err := s.GetEventsByTenantID(context.Background(), id)
				return len(events), events == nil, err
			},
		},
		{
			name: "GetAPIKeysByEventID",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM api_keys`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "event_id", "name", "key_hash", "key_hash_bcrypt", "key_preview", "expires_at", "last_used_at", "revoked_at", "created_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				keys, err := s.GetAPIKeysByEventID(context.Background(), id)
				return len(keys), keys == nil, err
			},
		},
		{
			name: "GetUserTenants",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM tenants t`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "name", "status", "settings", "logo_url", "website", "contact_email", "created_at", "updated_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				tenants, err := s.GetUserTenants(context.Background(), id)
				return len(tenants), tenants == nil, err
			},
		},
		{
			name: "GetAttendeesByEventID",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM attendees a`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows(attendeesByEventColumns))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				attendees, err := s.GetAttendeesByEventID(context.Background(), id, "", "")
				return len(attendees), attendees == nil, err
			},
		},
		{
			name: "GetZoneAccessRules",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM zone_access_rules`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "zone_id", "category", "allowed", "time_from", "time_to", "created_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				rules, err := s.GetZoneAccessRules(context.Background(), id)
				return len(rules), rules == nil, err
			},
		},
		{
			name: "GetAttendeeZoneAccessList",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM attendee_zone_access`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "attendee_id", "zone_id", "allowed", "notes", "created_at", "updated_at"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				accesses, err := s.GetAttendeeZoneAccessList(context.Background(), id)
				return len(accesses), accesses == nil, err
			},
		},
		{
			name: "GetStaffZoneAssignments",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM staff_zone_assignments\s+WHERE user_id`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "user_id", "zone_id", "assigned_at", "assigned_by"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				assignments, err := s.GetStaffZoneAssignments(context.Background(), id)
				return len(assignments), assignments == nil, err
			},
		},
		{
			name: "GetZoneStaffAssignments",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, _ time.Time) {
				mock.ExpectQuery(`FROM staff_zone_assignments\s+WHERE zone_id`).
					WithArgs(id).
					WillReturnRows(pgxmock.NewRows([]string{"id", "user_id", "zone_id", "assigned_at", "assigned_by"}))
			},
			run: func(s *PGStore, id uuid.UUID, _ time.Time) (int, bool, error) {
				assignments, err := s.GetZoneStaffAssignments(context.Background(), id)
				return len(assignments), assignments == nil, err
			},
		},
		{
			name: "GetZoneCheckins",
			setup: func(mock pgxmock.PgxPoolIface, id uuid.UUID, at time.Time) {
				mock.ExpectQuery(`FROM zone_checkins`).
					WithArgs(id, at.Truncate(24*time.Hour)).
					WillReturnRows(pgxmock.NewRows([]string{"id", "attendee_id", "zone_id", "checked_in_at", "checked_in_by", "event_day", "metadata"}))
			},
			run: func(s *PGStore, id uuid.UUID, at time.Time) (int, bool, error) {
				checkins, err := s.GetZoneCheckins(context.Background(), id, at)
				return len(checkins), checkins == nil, err
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			mock, err := pgxmock.NewPool()
			if err != nil {
				t.Fatalf("pgxmock.NewPool: %v", err)
			}
			defer mock.Close()
			defer func() {
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Errorf("unmet expectations: %v", err)
				}
			}()

			id := uuid.New()
			at := time.Now()
			tc.setup(mock, id, at)

			s := &PGStore{db: mock}
			length, isNil, err := tc.run(s, id, at)
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			if isNil {
				t.Fatalf("%s returned nil slice for zero rows, want non-nil empty slice", tc.name)
			}
			if length != 0 {
				t.Fatalf("%s: len = %d, want 0", tc.name, length)
			}
		})
	}
}
