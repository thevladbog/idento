package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

func TestPGStoreGetEventStaffUsesEventTenantLiveMembershipRole(t *testing.T) {
	tests := []struct {
		name             string
		homeRole         string
		membershipRole   string
		eventMatchesHome bool
	}{
		{
			name:           "home admin in tenant A is event staff in tenant B",
			homeRole:       "admin",
			membershipRole: "staff",
		},
		{
			name:             "current membership role wins after role change",
			homeRole:         "staff",
			membershipRole:   "manager",
			eventMatchesHome: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock, err := pgxmock.NewPool()
			if err != nil {
				t.Fatalf("pgxmock.NewPool: %v", err)
			}
			defer mock.Close()

			eventID := uuid.New()
			homeTenantID := uuid.New()
			eventTenantID := uuid.New()
			if tt.eventMatchesHome {
				eventTenantID = homeTenantID
			}
			userID := uuid.New()
			issuedAt := time.Now().UTC()
			createdAt := issuedAt.Add(-time.Hour)
			updatedAt := issuedAt.Add(-time.Minute)

			mock.ExpectQuery(`SELECT u\.id, e\.tenant_id, u\.email, ut\.role, u\.is_super_admin,\s+\(q\.user_id IS NOT NULL\), q\.created_at, u\.created_at, u\.updated_at\s+FROM users u\s+INNER JOIN event_staff es ON u\.id = es\.user_id\s+INNER JOIN events e ON e\.id = es\.event_id\s+INNER JOIN user_tenants ut ON ut\.user_id = u\.id AND ut\.tenant_id = e\.tenant_id\s+LEFT JOIN user_qr_credentials q ON q\.user_id = u\.id AND q\.tenant_id = e\.tenant_id\s+WHERE es\.event_id = \$1\s+ORDER BY es\.assigned_at DESC`).
				WithArgs(eventID).
				WillReturnRows(pgxmock.NewRows([]string{
					"id", "tenant_id", "email", "role", "is_super_admin", "has_qr_token", "qr_token_created_at", "created_at", "updated_at",
				}).AddRow(userID, eventTenantID, "staff@org.test", tt.membershipRole, false, true, &issuedAt, createdAt, updatedAt))

			s := &PGStore{db: mock}
			users, err := s.GetEventStaff(context.Background(), eventID)
			if err != nil {
				t.Fatalf("GetEventStaff: %v", err)
			}
			if len(users) != 1 {
				t.Fatalf("GetEventStaff returned %d users, want 1", len(users))
			}
			if users[0].TenantID != eventTenantID {
				t.Fatalf("TenantID = %s, want event tenant %s (home tenant %s)", users[0].TenantID, eventTenantID, homeTenantID)
			}
			if users[0].Role != tt.membershipRole {
				t.Fatalf("Role = %q, want live membership role %q (home role %q)", users[0].Role, tt.membershipRole, tt.homeRole)
			}
			if !users[0].HasQRToken || users[0].QRTokenCreatedAt == nil || !users[0].QRTokenCreatedAt.Equal(issuedAt) {
				t.Fatal("GetEventStaff did not preserve event-scoped QR credential metadata")
			}
			if users[0].QRToken != nil {
				t.Fatal("GetEventStaff selected raw credential material")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unmet expectations: %v", err)
			}
		})
	}
}
